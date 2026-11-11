import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TasksProposalSchema, type SpecState } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  listTasks,
  syncTasks,
  transition,
  writeArtifact,
  type Actor,
} from '@agentforge/orchestrator';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CURRENT_SPEC_FILE, createSddServer, resolveSpecId } from '../src/index.ts';

/**
 * The implementation-phase MCP server.
 *
 * Driven through a real MCP client over an in-memory transport, so the tool schemas,
 * the argument validation and the error shapes are all exercised as a client would see
 * them — not by calling the handlers directly.
 *
 * What is being proved is containment: the agent reaches the orchestrator only through
 * these five tools, and every rule the state machine enforces for the web API applies
 * to it identically. There is no tool here that can approve anything.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

let dir: string;
let db: Db;
let client: Client;

const tasks = TasksProposalSchema.parse({
  implementation_order_rationale: 'The validator lands first so the serialiser can be tested.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Add the mandatory-field validator',
      description: 'Validate the mandatory GST fields.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: [],
    },
    {
      id: 'TASK-002',
      title: 'Add the serialiser',
      description: 'Map the invoice onto the GST schema.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-002'],
      depends_on: ['TASK-001'],
    },
  ],
});

const requirementsPayload = {
  feature_summary: 'Export invoices as GST JSON.',
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
          then: 'every mandatory field is present',
          compliance_rule_key: 'GST-001',
        },
        {
          id: 'AC-002',
          given: 'an invoice missing the buyer GSTIN',
          when: 'the user exports it',
          then: 'the export is refused',
          compliance_rule_key: null,
        },
      ],
      source_refs: [],
      compliance_refs: ['GST-001'],
    },
  ],
  clarification_questions: [],
  non_goals: [],
};

const designPayload = {
  overview: 'A validator and a serialiser.',
  sections: [
    {
      id: 'DES-001',
      heading: 'Validator and serialiser',
      body: 'Validate first, then map onto the GST schema.',
      source_refs: [],
      requirement_ids: ['REQ-001'],
    },
  ],
  decisions: [],
  risks: [],
};

function current(specId: string) {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec;
}

/** Drives a greenfield spec to `target` through the real gates. */
function specAt(target: SpecState): string {
  const spec = createSpec(db, {
    title: 'GST invoice export',
    description: 'Export a finalised invoice as GST e-invoice JSON.',
    mode: 'greenfield',
    repo_path: null,
    actor: HUMAN,
  });

  const step = (to: SpecState, actor: Actor = ORCHESTRATOR): void => {
    transition(db, {
      specId: spec.id,
      from: current(spec.id).status,
      to,
      actor,
      expectedVersion: current(spec.id).version,
    });
  };

  const put = (kind: 'requirements' | 'design' | 'tasks', payload: unknown): void => {
    writeArtifact(db, {
      specId: spec.id,
      kind,
      payload,
      contentMd: `# ${kind}\n\nrendered for the test\n`,
      actor: { id: `${kind}-agent`, type: 'agent' },
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
      expectedVersion: current(spec.id).version,
    });
  };

  const steps: readonly (readonly [SpecState, () => void])[] = [
    [
      'REQ_DRAFTING',
      () => {
        step('REQ_DRAFTING');
      },
    ],
    [
      'REQ_AWAITING_APPROVAL',
      () => {
        put('requirements', requirementsPayload);
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
        put('design', designPayload);
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
        put('tasks', tasks);
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

  for (const [state, advance] of steps) {
    if (current(spec.id).status === target) break;
    advance();
    if (state === target) break;
  }

  if (current(spec.id).status !== target) {
    throw new Error(`could not reach ${target}; stopped at ${current(spec.id).status}`);
  }
  return spec.id;
}

/** Connects a client to a server scoped to one spec. */
async function connect(specId: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createSddServer({ db, specId });
  await server.connect(serverTransport);

  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await c.connect(clientTransport);
  return c;
}

/** Calls a tool and returns its text payload plus whether it was an error. */
async function call(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean; json: unknown }> {
  const result = await client.callTool({ name: tool, arguments: args });
  const content = result.content as { type: string; text?: string }[] | undefined;
  const text = content?.map((c) => c.text ?? '').join('\n') ?? '';
  const isError = result.isError === true;

  let json: unknown = null;
  if (!isError && text.trim().startsWith('{')) {
    json = JSON.parse(text);
  }
  return { text, isError, json };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-mcp-'));
  db = createDb(join(dir, 'mcp.db'));
});

afterEach(async () => {
  await client.close().catch(() => undefined);
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the exposed tool surface', () => {
  it('offers exactly the six implementation tools, and nothing that can approve', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'complete_task',
      'get_acceptance_criteria',
      'get_approved_spec',
      'next_task',
      'release_task',
      'start_task',
    ]);

    // The containment claim, checked as exact names rather than substrings:
    // get_approved_spec legitimately contains "approve" because it *reads* what was
    // approved. What must not exist is a tool that performs an approval or a transition.
    const names = new Set(tools.map((t) => t.name));
    for (const forbidden of [
      'approve_artifact',
      'decide_artifact',
      'transition',
      'reject_artifact',
      'set_status',
      'approve',
    ]) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
    // Every exposed tool is a read or a task-lifecycle write, nothing else.
    for (const name of names) {
      expect(name).toMatch(/^(get_|next_|start_task$|complete_task$|release_task$)/);
    }
  });

  it('describes each tool well enough for an agent to use it correctly', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(80);
    }

    const start = tools.find((t) => t.name === 'start_task');
    expect(start?.description).toContain('before editing');
  });
});

describe('get_approved_spec', () => {
  it('returns the approved artifacts and says editing is permitted', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    const { json } = await call('get_approved_spec');
    const body = json as Record<string, unknown>;

    expect(body['spec_id']).toBe(specId);
    expect(body['status']).toBe('READY_FOR_IMPLEMENTATION');
    expect(body['implementation_permitted']).toBe(true);
    expect(String(body['requirements_markdown'])).toContain('# requirements');
    expect(String(body['design_markdown'])).toContain('# design');
    expect(String(body['tasks_markdown'])).toContain('# tasks');
  });

  it('reports that editing is not permitted before release', async () => {
    client = await connect(specAt('DESIGN_AWAITING_APPROVAL'));

    const body = (await call('get_approved_spec')).json as Record<string, unknown>;
    // The agent is told plainly rather than discovering it when an edit is refused.
    expect(body['implementation_permitted']).toBe(false);
    expect(body['tasks_markdown']).toBeNull();
  });
});

describe('next_task', () => {
  it('returns the only unblocked task', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const body = (await call('next_task')).json as Record<string, unknown>;
    const task = body['task'] as Record<string, unknown>;

    expect(task['task_key']).toBe('TASK-001');
    expect(body['remaining']).toBe(2);
    expect(body['completed']).toBe(0);
  });

  it('does not offer a task whose dependency is incomplete', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    // TASK-002 depends on TASK-001, so it must not be offered first.
    const body = (await call('next_task')).json as Record<string, unknown>;
    expect((body['task'] as Record<string, unknown>)['task_key']).not.toBe('TASK-002');
  });
});

describe('start_task', () => {
  it('claims a task and moves the spec to IMPLEMENTING', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    const { json } = await call('start_task', { task_key: 'TASK-001' });
    const task = (json as Record<string, unknown>)['task'] as Record<string, unknown>;

    expect(task['status']).toBe('in_progress');
    expect(current(specId).status).toBe('IMPLEMENTING');

    // The transition is credited to the orchestrator, with the agent recorded as the
    // requester: an agent requests, the orchestrator moves the spec.
    const entry = listAuditEntries(db, specId).at(-1);
    expect(entry?.toState).toBe('IMPLEMENTING');
    expect(entry?.actorType).toBe('orchestrator');
    expect(JSON.parse(entry?.payload ?? 'null')).toMatchObject({
      task_key: 'TASK-001',
      requested_by: 'claude-code',
    });
  });

  it('refuses a task whose dependencies are incomplete', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const { isError, text } = await call('start_task', { task_key: 'TASK-002' });
    expect(isError).toBe(true);
    expect(text).toContain('depends on incomplete task');
  });

  it('refuses a second task while one is in progress', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));
    await call('start_task', { task_key: 'TASK-001' });

    const { isError, text } = await call('start_task', { task_key: 'TASK-002' });
    expect(isError).toBe(true);
    expect(text).toContain('already in progress');
  });

  it('refuses to start before the spec is released', async () => {
    client = await connect(specAt('DESIGN_APPROVED'));

    const { isError, text } = await call('start_task', { task_key: 'TASK-001' });
    expect(isError).toBe(true);
    expect(text).toContain('READY_FOR_IMPLEMENTATION');
  });

  it('rejects a malformed task key at the schema boundary', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    // The SDK enforces inputSchema and reports a violation as a tool error, so the
    // agent sees the refusal instead of the call proceeding with bad arguments.
    const { isError, text } = await call('start_task', { task_key: 'not-a-task' });
    expect(isError).toBe(true);
    expect(text).toContain('TASK-001');
  });

  it('is idempotent when the same agent re-claims its task', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));
    await call('start_task', { task_key: 'TASK-001' });

    // A reconnecting session must be able to resume rather than be told it is stuck.
    const { isError, json } = await call('start_task', { task_key: 'TASK-001' });
    expect(isError).toBe(false);
    const task = (json as Record<string, unknown>)['task'] as Record<string, unknown>;
    expect(task['status']).toBe('in_progress');
  });
});

describe('complete_task', () => {
  const EVIDENCE =
    'Added validateGstFields in src/billing/gst.ts; six unit tests in gst.test.ts cover ' +
    'each mandatory field and AC-001 passes.';

  it('records completion with evidence and unblocks the next task', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);
    await call('start_task', { task_key: 'TASK-001' });

    const { json } = await call('complete_task', { task_key: 'TASK-001', evidence: EVIDENCE });
    const body = json as Record<string, unknown>;

    expect(body['remaining']).toBe(1);
    expect(body['spec_completed']).toBe(false);

    const stored = listTasks(db, specId).find((t) => t.task_key === 'TASK-001');
    expect(stored?.status).toBe('completed');
    expect(stored?.completion_evidence).toBe(EVIDENCE);

    // TASK-002 is now available.
    const next = (await call('next_task')).json as Record<string, unknown>;
    expect((next['task'] as Record<string, unknown>)['task_key']).toBe('TASK-002');
  });

  it('refuses to complete a task that was never started', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const { isError, text } = await call('complete_task', {
      task_key: 'TASK-001',
      evidence: EVIDENCE,
    });
    expect(isError).toBe(true);
    // Refused on the spec state first: nothing was ever claimed, so the spec never left
    // READY_FOR_IMPLEMENTATION. Stricter than the per-task check and reached earlier.
    expect(text).toContain('IMPLEMENTING');
  });

  it('rejects thin evidence at the schema boundary', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));
    await call('start_task', { task_key: 'TASK-001' });

    // "done" is not a record of work. The schema minimum makes that non-negotiable,
    // and the SDK enforces it before our handler runs.
    const { isError, text } = await call('complete_task', {
      task_key: 'TASK-001',
      evidence: 'done',
    });
    expect(isError).toBe(true);
    expect(text).toContain('evidence');
  });

  it('moves the spec to DONE when the last task completes', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    for (const key of ['TASK-001', 'TASK-002']) {
      await call('start_task', { task_key: key });
      const { json } = await call('complete_task', { task_key: key, evidence: EVIDENCE });
      if (key === 'TASK-002') {
        expect((json as Record<string, unknown>)['spec_completed']).toBe(true);
      }
    }

    expect(current(specId).status).toBe('DONE');
    expect(listAuditEntries(db, specId).at(-1)?.toState).toBe('DONE');
  });
});

describe('release_task', () => {
  it('gives a claim back and returns the spec to READY_FOR_IMPLEMENTATION', async () => {
    // The edge that nothing used to drive. A session that claimed a task and stopped
    // left the spec in IMPLEMENTING with nothing in progress, and start_task refuses a
    // second claim while one is open — so the spec could not move at all.
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    await call('start_task', { task_key: 'TASK-001' });
    expect(current(specId).status).toBe('IMPLEMENTING');

    const { json } = await call('release_task', {
      task_key: 'TASK-001',
      reason: 'Picked up by mistake; this belongs to the other workstream.',
    });

    const body = json as Record<string, unknown>;
    expect((body['task'] as Record<string, unknown>)['status']).toBe('pending');
    expect(body['spec_status']).toBe('READY_FOR_IMPLEMENTATION');
    expect(current(specId).status).toBe('READY_FOR_IMPLEMENTATION');
  });

  it('lets the released task be claimed again', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);

    await call('start_task', { task_key: 'TASK-001' });
    await call('release_task', { task_key: 'TASK-001', reason: 'Abandoning this attempt.' });

    // The point of releasing rather than blocking: nothing is wrong with the task.
    const { json } = await call('start_task', { task_key: 'TASK-001' });
    expect((json as Record<string, unknown>)['task']).toMatchObject({ status: 'in_progress' });
    expect(current(specId).status).toBe('IMPLEMENTING');
  });

  it('refuses to release a task that was never claimed', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const { isError, text } = await call('release_task', {
      task_key: 'TASK-001',
      reason: 'Nothing was ever claimed here.',
    });

    expect(isError).toBe(true);
    expect(text).toContain('not in progress');
  });

  it('requires a reason, so the audit trail explains the gap', async () => {
    const specId = specAt('READY_FOR_IMPLEMENTATION');
    client = await connect(specId);
    await call('start_task', { task_key: 'TASK-001' });

    const { isError } = await call('release_task', { task_key: 'TASK-001', reason: 'no' });

    expect(isError).toBe(true);
    // And the claim is untouched: a refused release must not half-release.
    expect(current(specId).status).toBe('IMPLEMENTING');
  });
});

describe('get_acceptance_criteria', () => {
  it('returns the criteria a task must make pass', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const body = (await call('get_acceptance_criteria', { task_key: 'TASK-001' })).json as Record<
      string,
      unknown
    >;
    const criteria = body['criteria'] as Record<string, unknown>[];

    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.['id']).toBe('AC-001');
    expect(criteria[0]?.['requirement_id']).toBe('REQ-001');
    expect(criteria[0]?.['compliance_rule_key']).toBe('GST-001');
  });

  it('reports an unknown task plainly', async () => {
    client = await connect(specAt('READY_FOR_IMPLEMENTATION'));

    const body = (await call('get_acceptance_criteria', { task_key: 'TASK-999' })).json as Record<
      string,
      unknown
    >;
    expect(body['error']).toContain('no such task');
  });
});

describe('spec context resolution', () => {
  it('prefers the environment over the pin file', () => {
    mkdirSync(join(dir, '.sdd'), { recursive: true });
    writeFileSync(join(dir, CURRENT_SPEC_FILE.replace('.sdd/', '.sdd/')), 'spec_fromfile01\n');

    const previous = process.env['SDD_SPEC_ID'];
    process.env['SDD_SPEC_ID'] = 'spec_fromenv0001';
    try {
      expect(resolveSpecId(dir)).toBe('spec_fromenv0001');
    } finally {
      if (previous === undefined) delete process.env['SDD_SPEC_ID'];
      else process.env['SDD_SPEC_ID'] = previous;
    }
  });

  it('falls back to the pin file', () => {
    mkdirSync(join(dir, '.sdd'), { recursive: true });
    writeFileSync(join(dir, '.sdd', 'current-spec'), 'spec_fromfile01\n# a note\n');

    const previous = process.env['SDD_SPEC_ID'];
    delete process.env['SDD_SPEC_ID'];
    try {
      expect(resolveSpecId(dir)).toBe('spec_fromfile01');
    } finally {
      if (previous !== undefined) process.env['SDD_SPEC_ID'] = previous;
    }
  });

  it('returns null when the session is not scoped to a spec', () => {
    const previous = process.env['SDD_SPEC_ID'];
    delete process.env['SDD_SPEC_ID'];
    try {
      // Not an error: a session that is not implementing a spec is a normal session.
      expect(resolveSpecId(dir)).toBeNull();
    } finally {
      if (previous !== undefined) process.env['SDD_SPEC_ID'] = previous;
    }
  });

  it('rejects a value that is not a spec id', () => {
    const previous = process.env['SDD_SPEC_ID'];
    process.env['SDD_SPEC_ID'] = '../../etc/passwd';
    try {
      expect(() => resolveSpecId(dir)).toThrow(/does not look like a spec id/);
    } finally {
      if (previous === undefined) delete process.env['SDD_SPEC_ID'];
      else process.env['SDD_SPEC_ID'] = previous;
    }
  });
});
