import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPLEMENTATION_STATES, SPEC_STATES, type SpecState } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  startTask,
  syncTasks,
  transition,
  writeArtifact,
  type Actor,
} from '@agentforge/orchestrator';
import { TasksProposalSchema } from '@agentforge/contract';

/**
 * The PreToolUse hook.
 *
 * This is the project's governance claim reduced to one executable question: can an
 * edit happen before the work was approved? Every other tool in this space answers
 * "only if everyone cooperates". These tests answer it by running the real hook as a
 * real subprocess, with real JSON on stdin, and checking the exit code Claude Code
 * actually acts on.
 *
 * Subprocess rather than an imported function on purpose: the contract with the harness
 * is the process boundary — stdin shape, stdout JSON, exit code — and a unit test of an
 * internal function would prove none of it.
 */

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hook.ts');

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };
const AGENT: Actor = { id: 'claude-code', type: 'agent' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

let dir: string;
let dbPath: string;
let db: Db;

interface HookOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly decision: string | null;
  readonly reason: string | null;
}

/** Runs the hook as Claude Code would, and reports what the harness would see. */
function runHook(payload: Record<string, unknown>, env: Record<string, string> = {}): HookOutcome {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      // Captured, not inherited: the hook writes its refusal to stderr by design, and a
      // passing suite should not print a wall of denials.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SDD_DB_PATH: dbPath,
        // Cleared so a value leaking from the developer's shell cannot change a result.
        SDD_SPEC_ID: '',
        ...env,
      },
      timeout: 15_000,
    });
    return { status: 0, stdout, stderr: '', decision: null, reason: null };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    const stdout = e.stdout ?? '';
    const stderr = e.stderr ?? '';

    let decision: string | null = null;
    let reason: string | null = null;
    if (stdout.trim().length > 0) {
      const parsed: unknown = JSON.parse(stdout);
      const output = (parsed as { hookSpecificOutput?: Record<string, unknown> })
        .hookSpecificOutput;
      decision =
        typeof output?.['permissionDecision'] === 'string' ? output['permissionDecision'] : null;
      reason =
        typeof output?.['permissionDecisionReason'] === 'string'
          ? output['permissionDecisionReason']
          : null;
    }

    return { status: e.status ?? -1, stdout, stderr, decision, reason };
  }
}

const editPayload = (cwd: string, toolName = 'Edit') => ({
  session_id: 'test-session',
  transcript_path: '/tmp/transcript.jsonl',
  cwd,
  permission_mode: 'default',
  hook_event_name: 'PreToolUse',
  tool_name: toolName,
  tool_use_id: 'toolu_test',
  tool_input: {
    file_path: join(cwd, 'src', 'thing.ts'),
    old_string: 'a',
    new_string: 'b',
    replace_all: false,
  },
});

const tasks = TasksProposalSchema.parse({
  implementation_order_rationale: 'One task is enough to exercise the gate.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Add the validator',
      description: 'Validate the mandatory fields.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: [],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: [],
    },
  ],
});

/** Pins the working tree to a spec, the way `/sdd-implement` does. */
function pinSpec(specId: string): void {
  mkdirSync(join(dir, '.sdd'), { recursive: true });
  writeFileSync(join(dir, '.sdd', 'current-spec'), `${specId}\n`, 'utf8');
}

/** Drives a greenfield spec to the requested state through the real gates. */
function specAt(target: SpecState): string {
  const spec = createSpec(db, {
    title: 'GST invoice export',
    description: 'Export a finalised invoice as GST e-invoice JSON.',
    mode: 'greenfield',
    repo_path: null,
    actor: HUMAN,
  });

  const current = () => {
    const row = getSpec(db, spec.id);
    if (row === undefined) throw new Error('spec vanished');
    return row;
  };

  const payload = (kind: 'requirements' | 'design' | 'tasks'): unknown =>
    kind === 'tasks'
      ? tasks
      : kind === 'requirements'
        ? {
            feature_summary: 'Export invoices.',
            requirements: [
              {
                id: 'REQ-001',
                ears_pattern: 'event_driven',
                ears_statement: 'When a user exports an invoice, the system shall emit GST JSON.',
                rationale: 'Required for IRP upload.',
                priority: 'must',
                acceptance_criteria: [
                  {
                    id: 'AC-001',
                    given: 'a finalised invoice',
                    when: 'the user exports it',
                    then: 'all mandatory fields are present',
                    compliance_rule_key: null,
                  },
                ],
                source_refs: [],
                compliance_refs: [],
              },
            ],
            clarification_questions: [],
            non_goals: [],
          }
        : {
            overview: 'A serialiser.',
            sections: [
              {
                id: 'DES-001',
                heading: 'Serialiser',
                body: 'Map the invoice onto the GST schema.',
                source_refs: [],
                requirement_ids: ['REQ-001'],
              },
            ],
            decisions: [],
            risks: [],
          };

  const step = (to: SpecState, actor: Actor = ORCHESTRATOR): void => {
    transition(db, {
      specId: spec.id,
      from: current().status,
      to,
      actor,
      expectedVersion: current().version,
    });
  };

  const approve = (kind: 'requirements' | 'design'): void => {
    const head = getHeadArtifact(db, spec.id, kind);
    if (head === undefined) throw new Error(`no ${kind} artifact`);
    decideArtifact(db, {
      specId: spec.id,
      kind,
      contentHash: head.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: current().version,
    });
  };

  const put = (kind: 'requirements' | 'design' | 'tasks'): void => {
    writeArtifact(db, {
      specId: spec.id,
      kind,
      payload: payload(kind),
      contentMd: `# ${kind}\n`,
      actor: { id: `${kind}-agent`, type: 'agent' },
    });
  };

  const path: readonly (readonly [SpecState, () => void])[] = [
    [
      'REQ_DRAFTING',
      () => {
        step('REQ_DRAFTING');
      },
    ],
    [
      'REQ_AWAITING_APPROVAL',
      () => {
        put('requirements');
        step('REQ_AWAITING_APPROVAL');
      },
    ],
    [
      'REQ_APPROVED',
      () => {
        approve('requirements');
      },
    ],
    [
      'DESIGN_DRAFTING',
      () => {
        step('DESIGN_DRAFTING');
      },
    ],
    [
      'DESIGN_AWAITING_APPROVAL',
      () => {
        put('design');
        step('DESIGN_AWAITING_APPROVAL');
      },
    ],
    [
      'DESIGN_APPROVED',
      () => {
        approve('design');
      },
    ],
    [
      'TASKS_GENERATED',
      () => {
        put('tasks');
        step('TASKS_GENERATED');
        syncTasks(db, spec.id, tasks);
      },
    ],
    [
      'READY_FOR_IMPLEMENTATION',
      () => {
        step('READY_FOR_IMPLEMENTATION', HUMAN);
      },
    ],
  ];

  for (const [state, advance] of path) {
    if (current().status === target) break;
    advance();
    if (state === target) break;
  }

  if (current().status !== target) {
    throw new Error(`could not reach ${target}; stopped at ${current().status}`);
  }
  return spec.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-hook-'));
  dbPath = join(dir, 'data', 'agentforge.db');
  db = createDb(dbPath);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('state drift between the hook and the contract', () => {
  it('governs exactly the states the contract permits editing in', () => {
    // The hook inlines this list to stay dependency-free and fast. This test is the only
    // thing keeping the duplication honest.
    const hookSource = execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(HOOK)}, 'utf8'))`,
      ],
      { encoding: 'utf8' },
    );

    const match = /const IMPLEMENTATION_STATES: readonly string\[\] = \[([^\]]+)\]/.exec(
      hookSource,
    );
    expect(match, 'the hook must declare IMPLEMENTATION_STATES').not.toBeNull();

    const declared = (match?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);

    expect(declared).toEqual([...IMPLEMENTATION_STATES]);
  });
});

describe('sessions this hook does not govern', () => {
  it('allows an edit when no spec is pinned', () => {
    // A developer working on an unrelated project must not be blocked by this hook.
    const outcome = runHook(editPayload(dir));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout.trim()).toBe('');
  });

  it('allows a tool it does not govern, even mid-spec', () => {
    const specId = specAt('REQ_DRAFTING');
    pinSpec(specId);

    for (const tool of ['Read', 'Bash', 'Grep', 'Glob']) {
      const outcome = runHook({ ...editPayload(dir), tool_name: tool });
      expect(outcome.status, tool).toBe(0);
    }
  });
});

describe('edits before approval are refused', () => {
  const blockedStates: readonly SpecState[] = [
    'CREATED',
    'REQ_DRAFTING',
    'REQ_AWAITING_APPROVAL',
    'REQ_APPROVED',
    'DESIGN_DRAFTING',
    'DESIGN_AWAITING_APPROVAL',
    'DESIGN_APPROVED',
    'TASKS_GENERATED',
  ];

  it.each(blockedStates)('denies an edit while the spec is %s', (state) => {
    const specId = specAt(state);
    pinSpec(specId);

    const outcome = runHook(editPayload(dir));

    // Exit 2 is what Claude Code treats as a denial. Any other non-zero exit would be a
    // non-blocking error and the edit would proceed.
    expect(outcome.status).toBe(2);
    expect(outcome.decision).toBe('deny');
    expect(outcome.reason).toContain(state);
    expect(outcome.reason).toContain('approved by a human');
  });

  it.each(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])('denies %s, not just Edit', (tool) => {
    const specId = specAt('DESIGN_AWAITING_APPROVAL');
    pinSpec(specId);

    const outcome = runHook(editPayload(dir, tool));
    expect(outcome.status).toBe(2);
    expect(outcome.decision).toBe('deny');
  });

  it('names the spec and its state, so the refusal is actionable', () => {
    const specId = specAt('DESIGN_DRAFTING');
    pinSpec(specId);

    const outcome = runHook(editPayload(dir));
    expect(outcome.reason).toContain(specId);
    expect(outcome.reason).toContain('GST invoice export');
    expect(outcome.reason).toContain('DESIGN_DRAFTING');
  });
});

describe('edits after release require a claimed task', () => {
  it('denies an edit when the spec is released but no task is claimed', () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    pinSpec(specId);

    const outcome = runHook(editPayload(dir));

    // Stronger than the state check alone: every change has to be attributable to a
    // task and its acceptance criteria.
    expect(outcome.status).toBe(2);
    expect(outcome.decision).toBe('deny');
    expect(outcome.reason).toContain('no task is in progress');
    expect(outcome.reason).toContain('start_task');
  });

  it('allows an edit once a task is claimed', () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    pinSpec(specId);

    const spec = getSpec(db, specId);
    if (spec === undefined) throw new Error('spec vanished');
    startTask(db, {
      specId,
      taskKey: 'TASK-001',
      actor: AGENT,
      expectedVersion: spec.version,
    });

    const outcome = runHook(editPayload(dir));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout.trim()).toBe('');
  });

  it('reads the spec id from SDD_SPEC_ID as well as the pin file', () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    // No pin file written: the environment alone must scope the session.

    const outcome = runHook(editPayload(dir), { SDD_SPEC_ID: specId });
    expect(outcome.status).toBe(2);
    expect(outcome.reason).toContain('no task is in progress');
  });
});

describe('failing closed', () => {
  it('denies when the pinned spec does not exist', () => {
    pinSpec('spec_doesnotexist01');
    const outcome = runHook(editPayload(dir));

    expect(outcome.status).toBe(2);
    expect(outcome.reason).toContain('no such spec exists');
  });

  it('denies when the database is missing', () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    pinSpec(specId);

    const outcome = runHook(editPayload(dir), {
      SDD_DB_PATH: join(dir, 'nowhere', 'missing.db'),
    });

    // A governance hook that cannot check state must refuse, not shrug.
    expect(outcome.status).toBe(2);
    expect(outcome.reason).toContain('cannot be checked');
  });

  it('denies malformed input rather than guessing', () => {
    let status = -1;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [HOOK], {
        input: 'not json at all',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, SDD_DB_PATH: dbPath, SDD_SPEC_ID: '' },
        timeout: 15_000,
      });
      status = 0;
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      status = e.status ?? -1;
      stdout = e.stdout ?? '';
    }

    expect(status).toBe(2);
    expect(stdout).toContain('could not parse');
  });

  it('emits both the JSON decision and exit 2, so either mechanism blocks', () => {
    const specId = specAt('DESIGN_DRAFTING');
    pinSpec(specId);

    const outcome = runHook(editPayload(dir));

    // Belt and braces: a future change to the JSON contract still fails closed.
    expect(outcome.status).toBe(2);
    expect(outcome.decision).toBe('deny');
    expect(outcome.stderr.trim().length).toBeGreaterThan(0);
  });
});

describe('every spec state is accounted for', () => {
  it('permits editing in exactly two of the fifteen states', () => {
    // Not a tautology: it pins the ratio so a future state added to the contract cannot
    // quietly become editable.
    expect(SPEC_STATES).toHaveLength(15);
    expect(IMPLEMENTATION_STATES).toHaveLength(2);
    expect(
      SPEC_STATES.filter((s) => (IMPLEMENTATION_STATES as readonly string[]).includes(s)),
    ).toEqual(['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING']);
  });
});

describe('the hook answers quickly', () => {
  /**
   * The gate's own design note says a stalled hook is not a gate: Claude Code runs this
   * before every Edit, so latency here is latency on every edit a developer makes. The
   * hook is written to be dependency-free and to do one indexed read for that reason,
   * and this is the test that holds it to it.
   *
   * The bound is generous because most of the measured time is Node's own startup, which
   * the real hook also pays — the point is to catch a regression that makes it *stall*
   * (a network call, a migration, a full table scan), not to pin a millisecond figure
   * that would turn into a flake on a loaded CI runner.
   */
  it('decides in well under a second of its own work', () => {
    const specId = specAt('REQ_DRAFTING');
    pinSpec(specId);

    // One warm-up, so the measured run is not paying for first-touch disk I/O on the
    // database file and the Node binary.
    runHook(editPayload(dir));

    const startedAt = Date.now();
    const outcome = runHook(editPayload(dir));
    const elapsed = Date.now() - startedAt;

    expect(outcome.decision).toBe('deny');
    expect(elapsed, `hook took ${String(elapsed)}ms`).toBeLessThan(3_000);
  });
});
