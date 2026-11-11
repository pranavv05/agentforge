import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The whole pipeline, end to end, through the real HTTP routes.
 *
 * This exists because three separate bugs reached a user that every existing test
 * missed, and they were all the same shape: a legal edge in the transition table that
 * nothing in the product actually took. Suites that test one route in isolation cannot
 * catch that — each passes while the chain between them is broken.
 *
 * So this drives one spec from CREATED to DONE the way a person does, through the API
 * handlers and the MCP-facing orchestrator calls, and asserts the state after every
 * step. Specifically it would have caught:
 *
 * - tasks generation 409ing, because the route advanced into a result state;
 * - the spec stranding at TASKS_GENERATED, because nothing released it;
 * - and it fails if any future change breaks the chain between two working stages.
 *
 * The transport is stubbed and nothing else is: every route handler, guard, gate and
 * audit write executes for real.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-pipeline-'));
process.env['SDD_DB_PATH'] = join(dir, 'pipeline.db');
process.env['SDD_RUN_COST_CAP_USD'] = '5.00';

const { getDb, closeDb } = await import('@agentforge/db');
const {
  completeTask,
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  listTasks,
  startTask,
} = await import('@agentforge/orchestrator');
const contract = await import('@agentforge/contract');
const { installStub } = await import('../../../packages/llm/test/stub.ts');

const requirementsDraft = await import('@/app/api/specs/[id]/requirements/draft/route');
const designDraft = await import('@/app/api/specs/[id]/design/draft/route');
const tasksGenerate = await import('@/app/api/specs/[id]/tasks/generate/route');

const HUMAN = { id: 'reviewer@example.com', type: 'human' } as const;
const IMPLEMENTER = { id: 'claude-code', type: 'agent' } as const;

const { req } = await (await import('./session')).createTestSession(HUMAN.id);

const REQUIREMENTS = {
  feature_summary: 'Export invoices as GST JSON.',
  requirements: [
    {
      id: 'REQ-001',
      ears_pattern: 'event_driven',
      ears_statement: 'When a user exports an invoice, the system shall emit GST JSON.',
      rationale: 'Needed for IRP upload.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-001',
          given: 'a finalised invoice',
          when: 'the user exports it',
          then: 'a GST payload is produced',
          compliance_rule_key: null,
        },
      ],
      source_refs: [],
      compliance_refs: [],
    },
  ],
  clarification_questions: [],
  non_goals: [],
};

const DESIGN = {
  overview: 'A serialiser and a validator.',
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

const TASKS = {
  implementation_order_rationale: 'One task; nothing depends on anything.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Build the serialiser',
      description: 'Map the invoice onto the GST schema.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: [],
    },
  ],
};

let stub: ReturnType<typeof installStub>;
let specId: string;

function status(): string {
  const spec = getSpec(getDb(), specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec.status;
}

function version(): number {
  const spec = getSpec(getDb(), specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec.version;
}

/** Posts to a route handler the way the browser does, and asserts the status. */
async function post(
  handler: { POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> },
  path: string,
  body: Record<string, unknown>,
  expected = 200,
): Promise<unknown> {
  const response = await handler.POST(req(path, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: specId }),
  });
  const payload: unknown = await response.json();
  expect(response.status, JSON.stringify(payload).slice(0, 400)).toBe(expected);
  return payload;
}

/** Approves the head artifact of a kind, the way the document pane does. */
function approve(kind: 'requirements' | 'design' | 'tasks'): void {
  const head = getHeadArtifact(getDb(), specId, kind);
  if (head === undefined) throw new Error(`no ${kind} artifact to approve`);

  decideArtifact(getDb(), {
    specId,
    kind,
    contentHash: head.contentHash,
    decision: 'approve',
    actor: HUMAN,
    expectedVersion: version(),
  });
}

beforeAll(() => {
  stub = installStub();
});

afterAll(() => {
  stub.restore();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('a spec from a feature request to DONE', () => {
  it('starts in CREATED', () => {
    specId = createSpec(getDb(), {
      title: 'GST export',
      description: 'Export a finalised invoice as GST e-invoice JSON.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    }).id;

    expect(status()).toBe('CREATED');
  });

  it('drafts requirements straight from CREATED', async () => {
    // The route moves the spec into REQ_DRAFTING itself. Before that existed, nothing
    // over HTTP could start a spec at all.
    stub.reply({ output: REQUIREMENTS });

    await post(requirementsDraft, `/api/specs/${specId}/requirements/draft`, {
      expected_version: version(),
      idempotency_key: 'pipeline-req-1',
    });

    expect(status()).toBe('REQ_AWAITING_APPROVAL');
  });

  it('approves the requirements', () => {
    approve('requirements');
    expect(status()).toBe('REQ_APPROVED');
  });

  it('drafts the design from the approved requirements', async () => {
    stub.reply({ output: DESIGN });

    await post(designDraft, `/api/specs/${specId}/design/draft`, {
      expected_version: version(),
      idempotency_key: 'pipeline-design-1',
    });

    expect(status()).toBe('DESIGN_AWAITING_APPROVAL');
  });

  it('approves the design', () => {
    approve('design');
    expect(status()).toBe('DESIGN_APPROVED');
  });

  it('generates tasks from the approved design', async () => {
    // The step that 409ed in production: the route used to advance into
    // TASKS_GENERATED before the agent ran, and the tasks_artifact_exists guard
    // correctly refused.
    stub.reply({ output: TASKS });

    await post(tasksGenerate, `/api/specs/${specId}/tasks/generate`, {
      expected_version: version(),
      idempotency_key: 'pipeline-tasks-1',
    });

    expect(status()).toBe('TASKS_GENERATED');
    expect(listTasks(getDb(), specId)).toHaveLength(1);
  });

  it('waits for a human before file edits are permitted', () => {
    // The gate that did not exist. A spec reaching TASKS_GENERATED stopped there
    // forever, because nothing in the product performed the release.
    expect(contract.isAwaitingHuman('TASKS_GENERATED')).toBe(true);
  });

  it('releases for implementation when a human approves the tasks', () => {
    approve('tasks');
    expect(status()).toBe('READY_FOR_IMPLEMENTATION');

    // The release is a human decision, not an automated one: past this edge the
    // PreToolUse hook permits file edits.
    const entry = listAuditEntries(getDb(), specId).find(
      (row) => row.toState === 'READY_FOR_IMPLEMENTATION',
    );
    expect(entry?.actorType).toBe('human');
  });

  it('claims a task through the implementation phase', () => {
    startTask(getDb(), {
      specId,
      taskKey: 'TASK-001',
      actor: IMPLEMENTER,
      expectedVersion: version(),
    });
    expect(status()).toBe('IMPLEMENTING');
  });

  it('reaches DONE when the last task completes', () => {
    completeTask(getDb(), {
      specId,
      taskKey: 'TASK-001',
      actor: IMPLEMENTER,
      evidence: 'gst-export.test.ts covers AC-001',
      expectedVersion: version(),
    });

    expect(status()).toBe('DONE');
  });

  it('leaves an audit trail where no agent caused an approval', () => {
    const entries = listAuditEntries(getDb(), specId);

    // The whole governance claim, checked over a complete run: every gate was crossed
    // by a human, and no agent ever moved the spec.
    const approvals = entries.filter((row) =>
      ['REQ_APPROVED', 'DESIGN_APPROVED', 'READY_FOR_IMPLEMENTATION'].includes(row.toState),
    );
    expect(approvals).toHaveLength(3);
    for (const row of approvals) {
      expect(row.actorType, `${row.fromState ?? ''} -> ${row.toState}`).toBe('human');
    }

    expect(entries.filter((row) => row.actorType === 'agent')).toEqual([]);
  });
});
