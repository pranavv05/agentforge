import {
  IMPLEMENTATION_STATES,
  NotFoundError,
  type TaskRow as TaskRowView,
  TransitionError,
  ValidationError,
  isImplementationState,
} from '@agentforge/contract';
import { type Db, schema } from '@agentforge/db';
import { and, eq } from 'drizzle-orm';
import { newCorrelationId } from './logger.ts';
import { listTasks } from './tasks.ts';
import { requireSpec, transitionInTx } from './transition.ts';
import type { Actor, Tx } from './types.ts';

/**
 * The actor credited with the state change.
 *
 * An agent requests; the orchestrator transitions. Keeping that rule here matters even
 * though neither of these edges is an approval gate: the transition table does not admit
 * `agent` on them, and widening it to make a convenience work would erode the one
 * property the audit log is for. The requesting agent is recorded in the entry's payload,
 * so attribution is not lost.
 */
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

/**
 * Task lifecycle: claiming and completing work.
 *
 * These are the writes the implementation phase makes, reached through the MCP server
 * rather than called directly. Everything the implementing agent could get wrong is
 * checked here rather than trusted to it, because the agent is the least reliable
 * participant in the system and the one with the most incentive to proceed.
 */

/** Reads tasks inside an open transaction, so checks and writes see one snapshot. */
function tasksInTx(tx: Tx, specId: string): readonly TaskRowView[] {
  // Re-uses the same row mapping as the read path by selecting through Drizzle and
  // delegating; listTasks is safe to call with a transaction handle because Drizzle's
  // better-sqlite3 driver shares the connection.
  return listTasks(tx as unknown as Db, specId);
}

export interface StartTaskInput {
  readonly specId: string;
  readonly taskKey: string;
  readonly actor: Actor;
  readonly expectedVersion: number;
  readonly correlationId?: string;
}

/**
 * Claims a task for implementation.
 *
 * Three things are enforced rather than trusted: the spec must be in an implementation
 * state, the task's dependencies must be complete, and only one task may be in progress
 * at a time — an agent that claimed two would produce a change nobody could review as a
 * single unit.
 *
 * Claiming the first task is what moves the spec from READY_FOR_IMPLEMENTATION to
 * IMPLEMENTING, so the recorded state follows reality without the agent asking.
 */
export function startTask(db: Db, input: StartTaskInput): TaskRowView {
  const correlationId = input.correlationId ?? newCorrelationId();

  return db.transaction(
    (tx): TaskRowView => {
      const spec = requireSpec(tx, input.specId);

      if (!isImplementationState(spec.status)) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `tasks may only be started while the spec is in ${IMPLEMENTATION_STATES.join(
            ' or ',
          )}; it is in ${spec.status}`,
          { spec_id: spec.id, actual_state: spec.status },
        );
      }

      const all = tasksInTx(tx, input.specId);
      const task = all.find((t) => t.task_key === input.taskKey);

      if (task === undefined) {
        throw new NotFoundError(`task ${input.taskKey} does not exist for this spec`, {
          spec_id: input.specId,
          task_key: input.taskKey,
        });
      }

      // Idempotent: a reconnecting agent re-claiming its own task is not an error.
      if (task.status === 'in_progress') return task;

      if (task.status !== 'pending') {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `task ${input.taskKey} is ${task.status}, so it cannot be started`,
          { spec_id: input.specId, task_key: input.taskKey, status: task.status },
        );
      }

      const running = all.find((t) => t.status === 'in_progress');
      if (running !== undefined) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `task ${running.task_key} is already in progress; complete it before starting another`,
          { spec_id: input.specId, in_progress: running.task_key },
        );
      }

      const completed = new Set(all.filter((t) => t.status === 'completed').map((t) => t.task_key));
      const blockedBy = task.depends_on.filter((dep) => !completed.has(dep));
      if (blockedBy.length > 0) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `task ${input.taskKey} depends on incomplete task(s): ${blockedBy.join(', ')}`,
          { spec_id: input.specId, task_key: input.taskKey, blocked_by: blockedBy },
        );
      }

      const startedAt = new Date().toISOString();
      tx.update(schema.tasks)
        .set({ status: 'in_progress', startedAt })
        .where(and(eq(schema.tasks.specId, input.specId), eq(schema.tasks.taskKey, input.taskKey)))
        .run();

      if (spec.status === 'READY_FOR_IMPLEMENTATION') {
        transitionInTx(tx, {
          specId: spec.id,
          from: 'READY_FOR_IMPLEMENTATION',
          to: 'IMPLEMENTING',
          actor: ORCHESTRATOR,
          expectedVersion: input.expectedVersion,
          reason: `Implementation started on ${input.taskKey}.`,
          payload: { task_key: input.taskKey, requested_by: input.actor.id },
          correlationId,
        });
      }

      return { ...task, status: 'in_progress', started_at: startedAt };
    },
    { behavior: 'immediate' },
  );
}

export interface CompleteTaskInput {
  readonly specId: string;
  readonly taskKey: string;
  readonly evidence: string;
  readonly actor: Actor;
  readonly expectedVersion: number;
  readonly correlationId?: string;
}

export interface CompleteTaskResult {
  readonly task: TaskRowView;
  /** True when this was the last outstanding task and the spec moved to DONE. */
  readonly specCompleted: boolean;
  readonly remaining: number;
}

/**
 * Records a task as complete, with evidence.
 *
 * Evidence is mandatory here and at the database level: a completed task with no account
 * of what changed is not a record of work, it is an assertion. The demo inspects exactly
 * this field.
 *
 * When the last task completes, the spec moves to DONE. That is safe to derive rather
 * than ask for: DONE is not an approval gate — those sit on requirements and design — so
 * computing it from the task rows keeps the recorded state honest without weakening any
 * gate.
 */
export function completeTask(db: Db, input: CompleteTaskInput): CompleteTaskResult {
  const correlationId = input.correlationId ?? newCorrelationId();

  if (input.evidence.trim().length === 0) {
    throw new ValidationError('completion evidence must not be empty', {
      spec_id: input.specId,
      task_key: input.taskKey,
    });
  }

  return db.transaction(
    (tx): CompleteTaskResult => {
      const spec = requireSpec(tx, input.specId);

      if (spec.status !== 'IMPLEMENTING') {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `tasks may only be completed while the spec is IMPLEMENTING; it is in ${spec.status}`,
          { spec_id: spec.id, actual_state: spec.status },
        );
      }

      const all = tasksInTx(tx, input.specId);
      const task = all.find((t) => t.task_key === input.taskKey);

      if (task === undefined) {
        throw new NotFoundError(`task ${input.taskKey} does not exist for this spec`, {
          spec_id: input.specId,
          task_key: input.taskKey,
        });
      }

      // Idempotent: a retried completion is not a second completion.
      if (task.status === 'completed') {
        return {
          task,
          specCompleted: false,
          remaining: all.filter((t) => t.status !== 'completed').length,
        };
      }

      if (task.status !== 'in_progress') {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `task ${input.taskKey} is ${task.status}; it must be started before it can be completed`,
          { spec_id: input.specId, task_key: input.taskKey, status: task.status },
        );
      }

      const completedAt = new Date().toISOString();
      tx.update(schema.tasks)
        .set({ status: 'completed', completedAt, completionEvidence: input.evidence })
        .where(and(eq(schema.tasks.specId, input.specId), eq(schema.tasks.taskKey, input.taskKey)))
        .run();

      const remaining = all.filter(
        (t) => t.task_key !== input.taskKey && t.status !== 'completed',
      ).length;

      let specCompleted = false;
      if (remaining === 0) {
        transitionInTx(tx, {
          specId: spec.id,
          from: 'IMPLEMENTING',
          to: 'DONE',
          actor: ORCHESTRATOR,
          expectedVersion: input.expectedVersion,
          reason: 'Every task is complete.',
          payload: {
            last_task: input.taskKey,
            task_count: all.length,
            requested_by: input.actor.id,
          },
          correlationId,
        });
        specCompleted = true;
      }

      return {
        task: {
          ...task,
          status: 'completed',
          completed_at: completedAt,
          completion_evidence: input.evidence,
        },
        specCompleted,
        remaining,
      };
    },
    { behavior: 'immediate' },
  );
}

export interface BlockTaskInput {
  readonly specId: string;
  readonly taskKey: string;
  readonly reason: string;
}

/** Marks a task blocked, with a reason, so a stuck run is visible rather than silent. */
export function blockTask(db: Db, input: BlockTaskInput): TaskRowView {
  if (input.reason.trim().length === 0) {
    throw new ValidationError('a blocking reason must be given', {
      spec_id: input.specId,
      task_key: input.taskKey,
    });
  }

  return db.transaction(
    (tx): TaskRowView => {
      const all = tasksInTx(tx, input.specId);
      const task = all.find((t) => t.task_key === input.taskKey);

      if (task === undefined) {
        throw new NotFoundError(`task ${input.taskKey} does not exist for this spec`, {
          spec_id: input.specId,
          task_key: input.taskKey,
        });
      }

      if (task.status === 'completed') {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `task ${input.taskKey} is already complete and cannot be blocked`,
          { spec_id: input.specId, task_key: input.taskKey },
        );
      }

      tx.update(schema.tasks)
        .set({ status: 'blocked', completionEvidence: input.reason })
        .where(and(eq(schema.tasks.specId, input.specId), eq(schema.tasks.taskKey, input.taskKey)))
        .run();

      return { ...task, status: 'blocked', completion_evidence: input.reason };
    },
    { behavior: 'immediate' },
  );
}
