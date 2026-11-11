import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TasksProposalSchema, type AgentForgeError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  blockTask,
  completeTask,
  getSpec,
  getTask,
  listAuditEntries,
  listTasks,
  nextAvailableTask,
  startTask,
  syncTasks,
} from '../src/index.ts';
import { AGENT, driveTo, makeSpec, makeTestDb, type TestDb } from './helpers.ts';

/**
 * Claiming, completing and blocking tasks.
 *
 * The implementing agent is the least reliable participant in this system and the one
 * with the most incentive to proceed, so everything it could get wrong is checked here
 * rather than trusted to it. These tests drive each of those checks to failure.
 */

let ctx: TestDb;
let db: Db;

const EVIDENCE =
  'Added validateGstFields in src/billing/gst.ts; six unit tests in gst.test.ts cover each ' +
  'mandatory field and AC-001 passes.';

const tasks = TasksProposalSchema.parse({
  implementation_order_rationale: 'Validator first, then the serialiser, then the wiring.',
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
    {
      id: 'TASK-002',
      title: 'Add the serialiser',
      description: 'Map onto the GST schema.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: [],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: ['TASK-001'],
    },
  ],
});

function current(specId: string) {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec;
}

/** A spec released for implementation, with task rows materialised. */
function released(): string {
  const spec = makeSpec(db);
  driveTo(db, spec.id, 'READY_FOR_IMPLEMENTATION');
  syncTasks(db, spec.id, tasks);
  return spec.id;
}

const claim = (specId: string, taskKey: string) =>
  startTask(db, {
    specId,
    taskKey,
    actor: AGENT,
    expectedVersion: current(specId).version,
  });

const finish = (specId: string, taskKey: string, evidence = EVIDENCE) =>
  completeTask(db, {
    specId,
    taskKey,
    evidence,
    actor: AGENT,
    expectedVersion: current(specId).version,
  });

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => {
  ctx.cleanup();
});

describe('startTask', () => {
  it('claims a task and moves the spec to IMPLEMENTING', () => {
    const specId = released();
    const task = claim(specId, 'TASK-001');

    expect(task.status).toBe('in_progress');
    expect(task.started_at).not.toBeNull();
    expect(current(specId).status).toBe('IMPLEMENTING');
  });

  it('credits the transition to the orchestrator and records the requester', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    // An agent requests; the orchestrator moves the spec. Widening the transition table
    // to admit `agent` here would erode the property the audit log exists for.
    const entry = listAuditEntries(db, specId).at(-1);
    expect(entry?.toState).toBe('IMPLEMENTING');
    expect(entry?.actorType).toBe('orchestrator');
    expect(JSON.parse(entry?.payload ?? 'null')).toMatchObject({ requested_by: AGENT.id });
  });

  it('does not transition again when already IMPLEMENTING', () => {
    const specId = released();
    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');

    const before = listAuditEntries(db, specId).length;
    claim(specId, 'TASK-002');
    expect(listAuditEntries(db, specId)).toHaveLength(before);
  });

  it('refuses a task with incomplete dependencies', () => {
    const specId = released();
    try {
      claim(specId, 'TASK-002');
      throw new Error('expected the dependency check to refuse');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('TASK-001');
    }
  });

  it('refuses a second task while one is in progress', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    // A change spanning two tasks cannot be reviewed as a unit.
    expect(() => claim(specId, 'TASK-002')).toThrow(/already in progress/);
  });

  it('is idempotent when the same task is re-claimed', () => {
    const specId = released();
    const first = claim(specId, 'TASK-001');
    const again = claim(specId, 'TASK-001');

    // A reconnecting session resumes rather than being told it is stuck.
    expect(again.status).toBe('in_progress');
    expect(again.started_at).toBe(first.started_at);
  });

  it('refuses a task that is already complete', () => {
    const specId = released();
    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');

    expect(() => claim(specId, 'TASK-001')).toThrow(/is completed, so it cannot be started/);
  });

  it('refuses a blocked task', () => {
    const specId = released();
    blockTask(db, { specId, taskKey: 'TASK-001', reason: 'upstream API is unavailable' });

    expect(() => claim(specId, 'TASK-001')).toThrow(/is blocked, so it cannot be started/);
  });

  it('refuses an unknown task', () => {
    const specId = released();
    try {
      claim(specId, 'TASK-999');
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }
  });

  it('refuses to start before the spec is released', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'TASKS_GENERATED');
    syncTasks(db, spec.id, tasks);

    try {
      claim(spec.id, 'TASK-001');
      throw new Error('expected a precondition failure');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('READY_FOR_IMPLEMENTATION');
    }
  });
});

describe('completeTask', () => {
  it('records completion with evidence', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    const result = finish(specId, 'TASK-001');

    expect(result.task.status).toBe('completed');
    expect(result.task.completion_evidence).toBe(EVIDENCE);
    expect(result.remaining).toBe(1);
    expect(result.specCompleted).toBe(false);
    expect(getTask(db, specId, 'TASK-001')?.completed_at).not.toBeNull();
  });

  it('unblocks the dependent task', () => {
    const specId = released();
    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');

    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-002');
  });

  it('moves the spec to DONE when the last task completes', () => {
    const specId = released();
    for (const key of ['TASK-001', 'TASK-002']) {
      claim(specId, key);
      const result = finish(specId, key);
      if (key === 'TASK-002') {
        expect(result.specCompleted).toBe(true);
        expect(result.remaining).toBe(0);
      }
    }

    expect(current(specId).status).toBe('DONE');
    const entry = listAuditEntries(db, specId).at(-1);
    expect(entry?.toState).toBe('DONE');
    expect(entry?.actorType).toBe('orchestrator');
  });

  it('rejects empty evidence', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    // A completed task with no account of what changed is an assertion, not a record.
    for (const evidence of ['', '   ', '\n\t']) {
      expect(() => finish(specId, 'TASK-001', evidence)).toThrow(/must not be empty/);
    }
  });

  it('is idempotent when the same task is completed twice', () => {
    const specId = released();
    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');

    const again = finish(specId, 'TASK-001');
    expect(again.task.status).toBe('completed');
    expect(again.specCompleted).toBe(false);
    // Still one outstanding task; a retry is not a second completion.
    expect(again.remaining).toBe(1);
  });

  it('refuses a task that was never started', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    expect(() => finish(specId, 'TASK-002')).toThrow(/must be started before it can be completed/);
  });

  it('refuses an unknown task', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    try {
      finish(specId, 'TASK-999');
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }
  });

  it('refuses to complete while the spec is not IMPLEMENTING', () => {
    const specId = released();

    try {
      finish(specId, 'TASK-001');
      throw new Error('expected a precondition failure');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('PRECONDITION_FAILED');
      expect(e.message).toContain('IMPLEMENTING');
    }
  });
});

describe('blockTask', () => {
  it('marks a task blocked with its reason', () => {
    const specId = released();
    const task = blockTask(db, {
      specId,
      taskKey: 'TASK-001',
      reason: 'The upstream GST schema endpoint is unreachable.',
    });

    expect(task.status).toBe('blocked');
    expect(task.completion_evidence).toContain('unreachable');
    expect(getTask(db, specId, 'TASK-001')?.status).toBe('blocked');
  });

  it('makes the remaining work unstartable rather than silently skipped', () => {
    const specId = released();
    blockTask(db, { specId, taskKey: 'TASK-001', reason: 'blocked on an upstream fix' });

    // TASK-002 depends on the blocked task, so there is genuinely nothing to pick up —
    // and that is reported rather than looking like completion.
    expect(nextAvailableTask(db, specId)).toBeUndefined();
    expect(listTasks(db, specId).filter((t) => t.status === 'blocked')).toHaveLength(1);
  });

  it('requires a reason', () => {
    const specId = released();
    for (const reason of ['', '  ']) {
      expect(() => blockTask(db, { specId, taskKey: 'TASK-001', reason })).toThrow(
        /a blocking reason must be given/,
      );
    }
  });

  it('refuses to block a completed task', () => {
    const specId = released();
    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');

    expect(() => blockTask(db, { specId, taskKey: 'TASK-001', reason: 'changed my mind' })).toThrow(
      /already complete/,
    );
  });

  it('refuses an unknown task', () => {
    const specId = released();
    try {
      blockTask(db, { specId, taskKey: 'TASK-404', reason: 'nope' });
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }
  });

  it('can block an in-progress task', () => {
    const specId = released();
    claim(specId, 'TASK-001');

    const task = blockTask(db, {
      specId,
      taskKey: 'TASK-001',
      reason: 'The acceptance criterion is ambiguous; needs a human decision.',
    });
    expect(task.status).toBe('blocked');
    // The spec stays IMPLEMENTING: the run is stuck, not finished.
    expect(current(specId).status).toBe('IMPLEMENTING');
  });
});

describe('the implementation phase end to end', () => {
  it('runs release to DONE with a full audit trail', () => {
    const specId = released();

    claim(specId, 'TASK-001');
    finish(specId, 'TASK-001');
    claim(specId, 'TASK-002');
    finish(specId, 'TASK-002');

    expect(current(specId).status).toBe('DONE');

    const states = listAuditEntries(db, specId).map((e) => e.toState);
    expect(states.at(-2)).toBe('IMPLEMENTING');
    expect(states.at(-1)).toBe('DONE');

    // Every completed task carries evidence; that is what a reviewer reads later.
    for (const task of listTasks(db, specId)) {
      expect(task.status).toBe('completed');
      expect(task.completion_evidence?.length ?? 0).toBeGreaterThan(20);
    }

    // And nothing can be started afterwards, because DONE is terminal.
    expect(() => claim(specId, 'TASK-001')).toThrow();
  });
});
