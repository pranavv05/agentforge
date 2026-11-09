import {
  NotFoundError,
  type SpecState,
  TransitionError,
  isTerminalState,
} from '@agentforge/contract';
import { type Db, schema, toJsonColumn } from '@agentforge/db';
import { and, eq, sql } from 'drizzle-orm';
import { runGuards } from './guards.ts';
import { newId } from './ids.ts';
import { newCorrelationId, runLogger } from './logger.ts';
import { findRule } from './transitions.ts';
import type { Actor, SpecRow, Tx } from './types.ts';

/**
 * `transition()` — the only writer of `specs.status` in the entire system.
 *
 * Agents write proposal artifacts; humans record decisions; neither moves a spec. A
 * stage change happens here or not at all, and every one of them:
 *
 * 1. checks the caller's view of the world (`from`, `expectedVersion`) against the row;
 * 2. checks the move exists in the transition table;
 * 3. checks this *kind* of actor is allowed to make it (no agent may approve);
 * 4. runs the edge's guards against the same transaction;
 * 5. writes the new status with a conditional UPDATE on the version counter;
 * 6. appends an immutable audit entry.
 *
 * All six happen in one `IMMEDIATE` transaction, so there is no window in which a
 * second writer can interleave. The lint rule `no-restricted-syntax` blocks
 * `update(specs)` anywhere else in the codebase to keep this property true.
 */

export interface TransitionInput {
  readonly specId: string;
  /** The state the caller believes the spec is in. A mismatch is a conflict, not a no-op. */
  readonly from: SpecState;
  readonly to: SpecState;
  readonly actor: Actor;
  /** The `specs.version` the caller last read. Optimistic lock. */
  readonly expectedVersion: number;
  readonly reason?: string | null;
  /** Structured detail for the audit entry: the approved hash, the budget that tripped, etc. */
  readonly payload?: unknown;
  readonly correlationId?: string;
}

export interface TransitionResult {
  readonly spec: SpecRow;
  readonly auditId: string;
  readonly correlationId: string;
}

/** Loads a spec inside a transaction, or throws `NotFoundError`. */
export function requireSpec(tx: Tx, specId: string): SpecRow {
  const row = tx.select().from(schema.specs).where(eq(schema.specs.id, specId)).limit(1).all()[0];
  if (row === undefined) {
    throw new NotFoundError(`spec ${specId} does not exist`, { spec_id: specId });
  }
  return row;
}

/**
 * Appends an audit entry.
 *
 * `seq` comes from a counter bumped in the same transaction, so entries written inside
 * the same millisecond still have a total order — ISO timestamps alone are not enough
 * to reconstruct a fast run.
 */
export function appendAudit(
  tx: Tx,
  entry: {
    readonly specId: string;
    readonly fromState: SpecState | null;
    readonly toState: SpecState;
    readonly actor: Actor;
    readonly reason: string | null;
    readonly payload: unknown;
    readonly correlationId: string;
  },
): string {
  tx.update(schema.auditSeq)
    .set({ value: sql`${schema.auditSeq.value} + 1` })
    .where(eq(schema.auditSeq.id, 1))
    .run();

  const seqRow = tx
    .select({ value: schema.auditSeq.value })
    .from(schema.auditSeq)
    .where(eq(schema.auditSeq.id, 1))
    .limit(1)
    .all()[0];

  if (seqRow === undefined) {
    // Seeded by the initial migration; its absence means the database is not migrated.
    throw new Error('audit_seq row is missing; run migrations before writing audit entries');
  }

  const id = newId('aud');
  tx.insert(schema.auditLog)
    .values({
      id,
      specId: entry.specId,
      fromState: entry.fromState,
      toState: entry.toState,
      actor: entry.actor.id,
      actorType: entry.actor.type,
      reason: entry.reason,
      payload: toJsonColumn(entry.payload ?? null),
      correlationId: entry.correlationId,
      createdAt: new Date().toISOString(),
      seq: seqRow.value,
    })
    .run();

  return id;
}

/**
 * The transition itself, scoped to an existing transaction.
 *
 * Exported so a caller that must record something else atomically with the move — an
 * approval decision, a task claim — can do both inside one transaction rather than
 * leaving a window where the decision exists but the state has not changed.
 */
export function transitionInTx(tx: Tx, input: TransitionInput): TransitionResult {
  const correlationId = input.correlationId ?? newCorrelationId();
  const spec = requireSpec(tx, input.specId);

  if (spec.status !== input.from) {
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      `spec is in ${spec.status}, not ${input.from}; refresh and retry`,
      { spec_id: spec.id, actual_state: spec.status, expected_state: input.from },
    );
  }

  if (spec.version !== input.expectedVersion) {
    throw new TransitionError(
      'VERSION_CONFLICT',
      `spec version is ${String(spec.version)}, caller expected ${String(input.expectedVersion)}; ` +
        'another change landed first',
      { spec_id: spec.id, actual_version: spec.version, expected_version: input.expectedVersion },
    );
  }

  if (isTerminalState(spec.status)) {
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      `spec is in terminal state ${spec.status} and cannot be moved`,
      { spec_id: spec.id, actual_state: spec.status },
    );
  }

  const rule = findRule(input.from, input.to);
  if (rule === undefined) {
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      `${input.from} -> ${input.to} is not a legal transition`,
      { spec_id: spec.id, from: input.from, to: input.to },
    );
  }

  if (!rule.allowedActors.includes(input.actor.type)) {
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      `actor type "${input.actor.type}" may not perform ${input.from} -> ${input.to} ` +
        `(permitted: ${rule.allowedActors.join(', ')})`,
      {
        spec_id: spec.id,
        from: input.from,
        to: input.to,
        actor_type: input.actor.type,
        allowed_actors: rule.allowedActors,
      },
    );
  }

  runGuards(rule.guards, { tx, spec });

  const now = new Date().toISOString();
  const updated = tx
    .update(schema.specs)
    .set({ status: input.to, version: spec.version + 1, updatedAt: now })
    // Conditional on the version we validated: belt and braces behind the lock.
    .where(and(eq(schema.specs.id, spec.id), eq(schema.specs.version, input.expectedVersion)))
    .run();

  if (updated.changes !== 1) {
    throw new TransitionError(
      'VERSION_CONFLICT',
      'spec was modified concurrently; the transition was not applied',
      { spec_id: spec.id, expected_version: input.expectedVersion },
    );
  }

  const auditId = appendAudit(tx, {
    specId: spec.id,
    fromState: input.from,
    toState: input.to,
    actor: input.actor,
    reason: input.reason ?? rule.description,
    payload: input.payload ?? null,
    correlationId,
  });

  return {
    spec: { ...spec, status: input.to, version: spec.version + 1, updatedAt: now },
    auditId,
    correlationId,
  };
}

/**
 * Applies one transition in its own transaction.
 *
 * `immediate` takes the write lock at BEGIN, so two concurrent transitions serialise
 * there rather than discovering the conflict at COMMIT.
 */
export function transition(db: Db, input: TransitionInput): TransitionResult {
  const result = db.transaction((tx) => transitionInTx(tx, input), { behavior: 'immediate' });

  runLogger(result.correlationId, { spec_id: input.specId }).info(
    { from: input.from, to: input.to, actor: input.actor.id, actor_type: input.actor.type },
    'spec transitioned',
  );

  return result;
}
