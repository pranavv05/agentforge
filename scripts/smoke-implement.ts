/**
 * The implementation phase, driven through the real MCP server.
 *
 * Everything before this script is AgentForge's own work: four agents, three human
 * gates, three documents. Past the release gate the actor changes — the approved tasks
 * are handed to **Claude Code**, which claims and completes them over MCP while the
 * `PreToolUse` hook refuses file edits outside an approved state.
 *
 * That last leg had test coverage but had never been run as a separate process against
 * a real database, so it was the one part of the pipeline nobody had watched work. This
 * script does exactly what Claude Code does — spawns `packages/plugin/src/bin.ts` over
 * stdio, speaks MCP to it, and walks the task list to completion — with two deliberate
 * differences from the test suite:
 *
 * - it runs the server as a **subprocess launched from another directory**, which is how
 *   the plugin is really invoked and the only way to catch a path resolved against the
 *   wrong working directory;
 * - it runs against a **real database file**, not a fixture built in memory.
 *
 * It writes no code. The evidence it records says plainly that it is a smoke run, so a
 * spec driven by this script can never be mistaken for one a developer implemented.
 *
 *   npm run sdd:smoke:implement -- <spec-id>
 *
 * $0, no API key: the implementation phase is orchestration, not inference.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { REPO_ROOT, resolveDbPath } from '@agentforge/db';

const specId = process.argv[2];

if (specId === undefined || specId.length === 0) {
  process.stderr.write(
    'usage: npm run sdd:smoke:implement -- <spec-id>\n' +
      '  the spec must be at READY_FOR_IMPLEMENTATION\n',
  );
  process.exit(1);
}

/**
 * The text payload of a tool result, parsed as the JSON the server promises.
 *
 * Typed structurally rather than as `CallToolResult`, because `callTool` returns a union
 * that still includes the SDK's legacy `toolResult` shape. Narrowing here keeps the call
 * sites clean and means a server that returned something unexpected fails with a
 * sentence rather than a cast.
 */
function payload(result: Record<string, unknown>): Record<string, unknown> {
  const parts = result['content'];
  if (!Array.isArray(parts)) throw new Error('tool result carried no content array');

  const text = (parts as readonly unknown[])
    .map((part) =>
      typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .join('\n')
    .trim();

  if (text.length === 0) throw new Error('tool returned no text content');

  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`tool returned a non-object payload: ${text.slice(0, 120)}`);
  }

  return parsed as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const dbPath = resolveDbPath();

// Launched from somewhere else entirely, because Claude Code runs in the repository
// being implemented — not in this one. Any path the server resolves against its working
// directory rather than its own location fails here and nowhere else.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(REPO_ROOT, 'packages/plugin/src/bin.ts')],
  env: { ...process.env, SDD_DB_PATH: dbPath, SDD_SPEC_ID: specId },
  cwd: process.env['TMP'] ?? REPO_ROOT,
});

const client = new Client({ name: 'agentforge-implement-smoke', version: '0.1.0' });
await client.connect(transport);

process.stdout.write(`database   ${dbPath}\n`);

const tools = await client.listTools();
process.stdout.write(`tools      ${tools.tools.map((tool) => tool.name).join(', ')}\n`);

const spec = payload(
  await client.callTool({ name: 'get_approved_spec', arguments: { spec_id: specId } }),
);

process.stdout.write(
  `spec       ${str(spec['title'])}\n` +
    `status     ${str(spec['status'])}\n` +
    `editing    ${spec['implementation_permitted'] === true ? 'permitted' : 'NOT permitted'}\n`,
);

if (spec['implementation_permitted'] !== true) {
  process.stderr.write(
    '\nThe spec has not been released for implementation, so the hook would deny every\n' +
      'edit. Approve the tasks first — that gate is what permits file edits.\n',
  );
  await client.close();
  process.exit(1);
}

let completed = 0;

// Bounded rather than `while (true)`: a server bug that kept offering the same task
// would otherwise spin forever against a real database.
for (let round = 0; round < 50; round += 1) {
  const offer = payload(
    await client.callTool({ name: 'next_task', arguments: { spec_id: specId } }),
  );
  const task = offer['task'];

  if (task === null || task === undefined) {
    process.stdout.write(
      `\nnothing left to claim — ${str(offer['reason'] ?? 'no task offered')}\n`,
    );
    break;
  }

  const row = task as Record<string, unknown>;
  const key = str(row['task_key']);

  process.stdout.write(`\n${key}  ${str(row['title'])}\n`);

  const criteria = payload(
    await client.callTool({
      name: 'get_acceptance_criteria',
      arguments: { spec_id: specId, task_key: key },
    }),
  );
  const list = Array.isArray(criteria['acceptance_criteria'])
    ? criteria['acceptance_criteria']
    : [];
  process.stdout.write(
    `  verifies   ${
      list.map((item) => str((item as Record<string, unknown>)['id'])).join(', ') || '(none)'
    }\n`,
  );

  const started = payload(
    await client.callTool({ name: 'start_task', arguments: { spec_id: specId, task_key: key } }),
  );
  process.stdout.write(`  claimed    spec is ${str(started['spec_status'])}\n`);

  const finished = payload(
    await client.callTool({
      name: 'complete_task',
      arguments: {
        spec_id: specId,
        task_key: key,
        // Says what it is. This script writes no code, and evidence that implied
        // otherwise would be a lie recorded in an append-only log.
        evidence:
          `Smoke run: ${key} was claimed and completed through the MCP server to exercise ` +
          `the implementation phase end to end. No source files were modified.`,
      },
    }),
  );
  process.stdout.write(`  completed  spec is ${str(finished['spec_status'])}\n`);
  completed += 1;
}

const final = payload(
  await client.callTool({ name: 'get_approved_spec', arguments: { spec_id: specId } }),
);

process.stdout.write(
  `\n${String(completed)} task(s) completed. Final state: ${str(final['status'])}\n`,
);

await client.close();
