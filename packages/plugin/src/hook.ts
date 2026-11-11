/**
 * PreToolUse hook: deny file edits outside an approved implementation state.
 *
 * This is the governance claim's enforcement point. Spec Kit, OpenSpec, BMAD and Spec
 * Workflow MCP all have stage gates that a model or a human is *trusted* to respect.
 * Here, an edit attempted before the design is approved is refused by the harness
 * before the tool runs.
 *
 * ## Design constraints, all load-bearing
 *
 * **It must be fast.** This runs before every Edit and Write. So: no transpiler (Node
 * strips the types natively), no framework imports, one indexed read-only query, exit.
 *
 * **It must fail closed.** Claude Code treats exit 2 as a denial and *every other
 * non-zero exit as a non-blocking error* — a crashing hook would let the edit through.
 * So every internal failure exits 2 rather than throwing.
 *
 * **It must never stall.** A hook that hangs is not a gate, it is an outage. stdin is
 * read with a hard timeout.
 *
 * **It must not govern unrelated sessions.** With no spec pinned, this is simply not an
 * SDD implementation session and the hook allows the edit. Scope is deliberate: the
 * threat model is a capable model drifting off-spec, not an adversary with a shell.
 */
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * The states in which editing files is permitted.
 *
 * Duplicated from `@agentforge/contract` on purpose: importing the contract would pull
 * Zod and the whole package graph into a process that runs on every keystroke-level
 * tool call. `packages/plugin/test/hook.test.ts` asserts this list still equals
 * `IMPLEMENTATION_STATES`, so the duplication cannot drift silently.
 */
const IMPLEMENTATION_STATES: readonly string[] = ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING'];

/** Tools this hook governs. Kept in step with the plugin's matcher. */
const GOVERNED_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];

const STDIN_TIMEOUT_MS = 2_000;

interface HookInput {
  readonly tool_name?: unknown;
  readonly cwd?: unknown;
  readonly tool_input?: { readonly file_path?: unknown } | undefined;
}

/** Emits the allow outcome: no output, exit 0, normal permission flow continues. */
function allow(): never {
  process.exit(0);
}

/**
 * Emits a denial.
 *
 * Writes the documented `hookSpecificOutput` JSON *and* exits 2. Either alone would
 * work; doing both means a future change to the JSON contract still fails closed,
 * because exit 2 is honoured independently.
 */
function deny(reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** Reads all of stdin, or gives up. A hook that waits forever is not a gate. */
async function readStdin(): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let data = '';
    const timer = setTimeout(() => {
      rejectPromise(new Error(`no input within ${String(STDIN_TIMEOUT_MS)}ms`));
    }, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolvePromise(data);
    });
    process.stdin.on('error', (error: Error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
  });
}

/** The spec this session is implementing, or null when it is not implementing one. */
function resolveSpecId(cwd: string): string | null {
  const fromEnv = process.env['SDD_SPEC_ID']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0 && !isUnexpandedPlaceholder(fromEnv)) {
    return fromEnv;
  }

  const file = resolve(cwd, join('.sdd', 'current-spec'));
  if (!existsSync(file)) return null;

  const firstLine = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? '';
  return firstLine.length > 0 ? firstLine : null;
}

/**
 * `${FOO}` that nothing expanded.
 *
 * Kept in step with the same check in the MCP server: a manifest or wrapper declaring
 * `"SDD_SPEC_ID": "${SDD_SPEC_ID}"` passes the literal text through when the variable is
 * unset, and a non-empty garbage value would otherwise outrank `.sdd/current-spec`.
 */
function isUnexpandedPlaceholder(value: string): boolean {
  return /^\${[A-Za-z_][A-Za-z0-9_]*}$/.test(value);
}

/** The database path, resolved the same way the application resolves it. */
function resolveDbPath(cwd: string): string {
  const fromEnv = process.env['SDD_DB_PATH']?.trim();
  const usable =
    fromEnv !== undefined && fromEnv.length > 0 && !isUnexpandedPlaceholder(fromEnv)
      ? fromEnv
      : './data/agentforge.db';
  return isAbsolute(usable) ? usable : resolve(cwd, usable);
}

interface SpecRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

interface TaskRow {
  readonly task_key: string;
}

async function main(): Promise<void> {
  const raw = await readStdin();

  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    // Malformed input means we cannot tell what is being attempted.
    deny('The AgentForge governance hook could not parse its input, so it refused the edit.');
  }

  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  if (!GOVERNED_TOOLS.includes(toolName)) allow();

  const cwd = typeof input.cwd === 'string' && input.cwd.length > 0 ? input.cwd : process.cwd();

  const specId = resolveSpecId(cwd);
  // Not an SDD implementation session: this hook has no authority here.
  if (specId === null) allow();

  const dbPath = resolveDbPath(cwd);
  if (!existsSync(dbPath)) {
    deny(
      `This session is pinned to spec ${specId}, but the AgentForge database is not at ` +
        `${dbPath}, so the spec's state cannot be checked. Editing is refused. ` +
        'Set SDD_DB_PATH, or clear .sdd/current-spec if this is not an SDD session.',
    );
  }

  let db: Database.Database | null = null;
  try {
    // Read-only, and it never blocks on a writer: WAL readers do not wait, and a hook
    // that waited on a lock would stall the session.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 1000');

    const spec = db
      .prepare<[string], SpecRow>('SELECT id, title, status FROM specs WHERE id = ?')
      .get(specId);

    if (spec === undefined) {
      deny(
        `This session is pinned to spec ${specId}, but no such spec exists in the ` +
          'AgentForge database. Editing is refused.',
      );
    }

    if (!IMPLEMENTATION_STATES.includes(spec.status)) {
      deny(
        `Spec ${spec.id} ("${spec.title}") is in ${spec.status}. File edits are permitted ` +
          `only in ${IMPLEMENTATION_STATES.join(' or ')}, which requires the requirements ` +
          'and the design to have been approved by a human and the spec released for ' +
          'implementation. Editing is refused.',
      );
    }

    // Stronger than the state check alone: work must be claimed before it is done, so
    // every change is attributable to a task and its acceptance criteria.
    const claimed = db
      .prepare<[string], TaskRow>(
        "SELECT task_key FROM tasks WHERE spec_id = ? AND status = 'in_progress' LIMIT 1",
      )
      .get(specId);

    if (claimed === undefined) {
      deny(
        `Spec ${spec.id} is released for implementation, but no task is in progress. ` +
          'Call the start_task tool to claim one before editing files, so the change is ' +
          'attributable to a task and its acceptance criteria.',
      );
    }
  } catch (error) {
    // Fail closed. Any other non-zero exit would let the edit through.
    const detail = error instanceof Error ? error.message : String(error);
    deny(`The AgentForge governance hook failed while checking spec state: ${detail}`);
  } finally {
    db?.close();
  }

  allow();
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  deny(`The AgentForge governance hook failed: ${detail}`);
});
