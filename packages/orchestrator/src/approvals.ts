import {
  APPROVAL_STATE_FOR_ARTIFACT,
  type ApprovalDecision,
  type ArtifactKind,
  DRAFTING_STATE_FOR_ARTIFACT,
  type SpecState,
  TransitionError,
} from '@agentforge/contract';
import { type Db, schema } from '@agentforge/db';
import { and, desc, eq } from 'drizzle-orm';
import { headArtifact } from './guards.ts';
import { newId } from './ids.ts';
import { newCorrelationId, runLogger } from './logger.ts';
import { requireSpec, transitionInTx } from './transition.ts';
import type { Actor } from './types.ts';

/**
 * Human approval decisions.
 *
 * This is the hash-binding gate in action. A decision must name the content hash the
 * reviewer actually saw; if the artifact has moved on since the page was rendered, the
 * submission is rejected with `HASH_MISMATCH` rather than being applied to content
 * nobody reviewed. That single check is the difference between a real gate and a
 * convention.
 *
 * The decision row and the resulting state change are written in one transaction, so
 * there is no window in which an approval exists but the spec has not advanced.
 */

export interface DecideArtifactInput {
  readonly specId: string;
  readonly kind: ArtifactKind;
  /** The hash of the content the reviewer saw. Must match the head version. */
  readonly contentHash: string;
  readonly decision: ApprovalDecision;
  readonly comment?: string | null;
  readonly actor: Actor;
  readonly expectedVersion: number;
  readonly correlationId?: string;
}

export interface DecideArtifactResult {
  readonly approvalId: string;
  readonly spec: typeof schema.specs.$inferSelect;
  readonly correlationId: string;
}

/** Which state a decision moves the spec to. */
function targetState(kind: ArtifactKind, decision: ApprovalDecision): SpecState {
  if (decision === 'approve') {
    const approved: Partial<Record<ArtifactKind, SpecState>> = {
      requirements: 'REQ_APPROVED',
      design: 'DESIGN_APPROVED',
    };
    const state = approved[kind];
    if (state === undefined) {
      throw new TransitionError(
        'PRECONDITION_FAILED',
        `artifact kind "${kind}" has no approval gate`,
        { kind },
      );
    }
    return state;
  }

  // Reject and request_changes both return to drafting; the comment distinguishes them
  // for the reviewer, and the audit log records which was used.
  return DRAFTING_STATE_FOR_ARTIFACT[kind];
}

export function decideArtifact(db: Db, input: DecideArtifactInput): DecideArtifactResult {
  const correlationId = input.correlationId ?? newCorrelationId();

  const gateState = APPROVAL_STATE_FOR_ARTIFACT[input.kind];
  if (gateState === null) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `artifact kind "${input.kind}" is not subject to human approval`,
      { kind: input.kind },
    );
  }

  const result = db.transaction(
    (tx): DecideArtifactResult => {
      const spec = requireSpec(tx, input.specId);

      if (spec.status !== gateState) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `spec must be in ${gateState} to decide on ${input.kind}; it is in ${spec.status}`,
          {
            spec_id: spec.id,
            kind: input.kind,
            actual_state: spec.status,
            required_state: gateState,
          },
        );
      }

      const head = headArtifact(tx, spec.id, input.kind);
      if (head === undefined) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `no ${input.kind} artifact exists to decide on`,
          { spec_id: spec.id, kind: input.kind },
        );
      }

      if (head.contentHash !== input.contentHash) {
        throw new TransitionError(
          'HASH_MISMATCH',
          `the submitted content hash does not match the current ${input.kind} version ` +
            `(submitted ${input.contentHash.slice(0, 12)}, current ${head.contentHash.slice(0, 12)}). ` +
            'The artifact changed after it was rendered; re-read it before deciding.',
          {
            spec_id: spec.id,
            kind: input.kind,
            submitted_hash: input.contentHash,
            current_hash: head.contentHash,
            current_version: head.version,
          },
        );
      }

      const approvalId = newId('apr');
      tx.insert(schema.approvals)
        .values({
          id: approvalId,
          specId: spec.id,
          artifactKind: input.kind,
          artifactVersionId: head.id,
          contentHash: head.contentHash,
          decision: input.decision,
          comment: input.comment ?? null,
          actor: input.actor.id,
          createdAt: new Date().toISOString(),
        })
        .run();

      // The approval row must exist before the transition runs: the
      // `*_approved_and_unchanged` guard reads it.
      const transitioned = transitionInTx(tx, {
        specId: spec.id,
        from: spec.status,
        to: targetState(input.kind, input.decision),
        actor: input.actor,
        expectedVersion: input.expectedVersion,
        reason:
          input.decision === 'approve'
            ? `${input.kind} approved at ${head.contentHash.slice(0, 12)}`
            : `${input.kind} ${input.decision.replace('_', ' ')}`,
        payload: {
          decision: input.decision,
          artifact_kind: input.kind,
          artifact_version: head.version,
          content_hash: head.contentHash,
          approval_id: approvalId,
        },
        correlationId,
      });

      return { approvalId, spec: transitioned.spec, correlationId };
    },
    { behavior: 'immediate' },
  );

  runLogger(correlationId, { spec_id: input.specId }).info(
    { kind: input.kind, decision: input.decision, actor: input.actor.id },
    'artifact decision recorded',
  );

  return result;
}

/** Every decision for a spec, newest first. */
export function listApprovals(
  db: Db,
  specId: string,
): readonly (typeof schema.approvals.$inferSelect)[] {
  return db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.specId, specId))
    .orderBy(desc(schema.approvals.createdAt), desc(schema.approvals.id))
    .all();
}

/** The most recent decision for one artifact kind, or `undefined`. */
export function latestApproval(
  db: Db,
  specId: string,
  kind: ArtifactKind,
): typeof schema.approvals.$inferSelect | undefined {
  return db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.specId, specId), eq(schema.approvals.artifactKind, kind)))
    .orderBy(desc(schema.approvals.createdAt), desc(schema.approvals.id))
    .limit(1)
    .all()[0];
}
