import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TasksProposalSchema, type TasksProposal } from '@agentforge/contract';
import { type Db, schema } from '@agentforge/db';
import { eq } from 'drizzle-orm';
import {
  getTask,
  listTasks,
  nextAvailableTask,
  syncTasks,
  tasksWithMissingDependencies,
} from '../src/index.ts';
import { driveTo, makeSpec, makeTestDb, type TestDb } from './helpers.ts';

/**
 * Task rows.
 *
 * Two invariants matter beyond the plumbing:
 *
 * 1. task progress never mutates the approved artifact, so re-syncing after work has
 *    started must not reset anything;
 * 2. `next_task` honours declared dependencies, so an implementing agent cannot pick up
 *    work whose prerequisites have not landed.
 */

let ctx: TestDb;
let db: Db;

const proposal: TasksProposal = TasksProposalSchema.parse({
  implementation_order_rationale: 'Counter first, then the pure date logic.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Add counter table',
      description: 'Migration plus allocate().',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [
        {
          file: 'packages/db/src/schema.ts',
          line_start: 10,
          line_end: 20,
          symbol: 'specs',
          evidence_id: 'EV-001',
        },
      ],
      verifies: ['AC-001', 'AC-002'],
      depends_on: [],
    },
    {
      id: 'TASK-002',
      title: 'Derive series key',
      description: 'Map a date to its financial year.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-002'],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: ['TASK-001'],
    },
    {
      id: 'TASK-003',
      title: 'Wire it into finalisation',
      description: 'Call allocate() inside the transaction.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-002'],
      depends_on: ['TASK-001', 'TASK-002'],
    },
  ],
});

/** Drives a spec to TASKS_GENERATED and materialises the task rows. */
function seedTasks(): string {
  const spec = makeSpec(db);
  driveTo(db, spec.id, 'TASKS_GENERATED');
  syncTasks(db, spec.id, proposal);
  return spec.id;
}

/** Marks a task completed the way the MCP complete_task call will. */
function complete(specId: string, taskKey: string): void {
  db.update(schema.tasks)
    .set({
      status: 'completed',
      completionEvidence: 'done, with tests',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.taskKey, taskKey))
    .run();
}

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => {
  ctx.cleanup();
});

describe('syncTasks', () => {
  it('materialises every task as pending', () => {
    const specId = seedTasks();
    const tasks = listTasks(db, specId);

    expect(tasks.map((t) => t.task_key)).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(tasks.every((t) => t.started_at === null && t.completed_at === null)).toBe(true);
  });

  it('round-trips the traceability fields through their JSON columns', () => {
    const specId = seedTasks();
    const first = getTask(db, specId, 'TASK-001');

    expect(first?.requirement_ids).toEqual(['REQ-001']);
    expect(first?.design_section_ids).toEqual(['DES-001']);
    expect(first?.verifies).toEqual(['AC-001', 'AC-002']);
    expect(first?.depends_on).toEqual([]);
    expect(first?.source_refs[0]?.symbol).toBe('specs');
    expect(getTask(db, specId, 'TASK-003')?.depends_on).toEqual(['TASK-001', 'TASK-002']);
  });

  it('starts every task pending even if the artifact claims otherwise', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'TASKS_GENERATED');

    const dishonest = TasksProposalSchema.parse({
      ...proposal,
      tasks: [{ ...proposal.tasks[0], status: 'completed' }],
    });
    syncTasks(db, spec.id, dishonest);

    // An artifact cannot declare work already done; only complete_task can.
    expect(listTasks(db, spec.id)[0]?.status).toBe('pending');
  });

  it('is idempotent and preserves progress on re-sync', () => {
    const specId = seedTasks();
    complete(specId, 'TASK-001');

    const inserted = syncTasks(db, specId, proposal);

    expect(inserted).toBe(0);
    expect(getTask(db, specId, 'TASK-001')?.status).toBe('completed');
    expect(listTasks(db, specId)).toHaveLength(3);
  });

  it('adds tasks introduced by a later artifact version without touching existing ones', () => {
    const specId = seedTasks();
    complete(specId, 'TASK-001');

    const extended = TasksProposalSchema.parse({
      ...proposal,
      tasks: [
        ...proposal.tasks,
        {
          id: 'TASK-004',
          title: 'Backfill historical series',
          description: 'One-off script.',
          status: 'pending',
          requirement_ids: ['REQ-001'],
          design_section_ids: [],
          source_refs: [],
          verifies: ['AC-001'],
          depends_on: ['TASK-003'],
        },
      ],
    });

    expect(syncTasks(db, specId, extended)).toBe(1);
    expect(getTask(db, specId, 'TASK-001')?.status).toBe('completed');
    expect(listTasks(db, specId)).toHaveLength(4);
  });

  it('keeps a completed task that a later artifact version drops', () => {
    const specId = seedTasks();
    complete(specId, 'TASK-001');

    const trimmed = TasksProposalSchema.parse({
      ...proposal,
      tasks: [proposal.tasks[1]],
    });
    syncTasks(db, specId, trimmed);

    // Deleting it would erase evidence of work that really happened.
    expect(getTask(db, specId, 'TASK-001')?.status).toBe('completed');
  });
});

describe('nextAvailableTask', () => {
  it('returns the only task with no dependencies', () => {
    const specId = seedTasks();
    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-001');
  });

  it('unblocks the next task once its dependency completes', () => {
    const specId = seedTasks();
    complete(specId, 'TASK-001');
    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-002');
  });

  it('keeps a multi-dependency task blocked until every predecessor is done', () => {
    const specId = seedTasks();
    complete(specId, 'TASK-001');
    // TASK-003 needs both 001 and 002, so 002 is still the right answer.
    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-002');

    complete(specId, 'TASK-002');
    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-003');
  });

  it('resumes an in-progress task rather than starting a second one', () => {
    const specId = seedTasks();
    db.update(schema.tasks)
      .set({ status: 'in_progress', startedAt: new Date().toISOString() })
      .where(eq(schema.tasks.taskKey, 'TASK-001'))
      .run();

    expect(nextAvailableTask(db, specId)?.task_key).toBe('TASK-001');
  });

  it('returns nothing when all tasks are complete', () => {
    const specId = seedTasks();
    for (const key of ['TASK-001', 'TASK-002', 'TASK-003']) complete(specId, key);
    expect(nextAvailableTask(db, specId)).toBeUndefined();
  });

  it('returns nothing when the remaining work is blocked', () => {
    const specId = seedTasks();
    db.update(schema.tasks)
      .set({ status: 'blocked' })
      .where(eq(schema.tasks.taskKey, 'TASK-001'))
      .run();

    // TASK-002 and TASK-003 depend on a blocked task, so there is nothing to pick up.
    expect(nextAvailableTask(db, specId)).toBeUndefined();
  });

  it('returns nothing for a spec with no tasks', () => {
    const spec = makeSpec(db);
    expect(nextAvailableTask(db, spec.id)).toBeUndefined();
  });
});

describe('getTask', () => {
  it('returns undefined for an unknown key', () => {
    const specId = seedTasks();
    expect(getTask(db, specId, 'TASK-999')).toBeUndefined();
  });
});

describe('tasksWithMissingDependencies', () => {
  it('finds nothing wrong with a coherent plan', () => {
    const specId = seedTasks();
    expect(tasksWithMissingDependencies(db, specId)).toEqual([]);
  });

  it('reports a dependency on a task that does not exist', () => {
    const spec = makeSpec(db);
    driveTo(db, spec.id, 'TASKS_GENERATED');

    const broken = TasksProposalSchema.parse({
      ...proposal,
      tasks: [
        {
          ...proposal.tasks[0],
          id: 'TASK-001',
          depends_on: ['TASK-404'],
        },
      ],
    });
    syncTasks(db, spec.id, broken);

    // A task that can never start is a planning bug, surfaced rather than ignored.
    expect(tasksWithMissingDependencies(db, spec.id)).toEqual([
      { task_key: 'TASK-001', missing: ['TASK-404'] },
    ]);
  });
});
