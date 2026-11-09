import { type ArtifactKind, TransitionError } from '@agentforge/contract';
import { schema } from '@agentforge/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { GuardName } from './transitions.ts';
import type { SpecRow, Tx } from './types.ts';

/**
 * Guard implementations.
 *
 * Every guard runs inside the same transaction as the state write, so a guard cannot
 * pass against a snapshot that another writer has already invalidated. Guards throw
 * `TransitionError` with a specific code rather than returning a boolean, because the
 * caller needs to know *which* precondition failed in order to say anything useful.
 */

export interface GuardContext {
  readonly tx: Tx;
  readonly spec: SpecRow;
}

/** The head (highest-version) artifact of a kind, or undefined when none exists. */
export function headArtifact(
  tx: Tx,
  specId: string,
  kind: ArtifactKind,
): { id: string; version: number; contentHash: string } | undefined {
  const rows = tx
    .select({
      id: schema.artifactVersions.id,
      version: schema.artifactVersions.version,
      contentHash: schema.artifactVersions.contentHash,
    })
    .from(schema.artifactVersions)
    .where(and(eq(schema.artifactVersions.specId, specId), eq(schema.artifactVersions.kind, kind)))
    .orderBy(desc(schema.artifactVersions.version))
    .limit(1)
    .all();

  return rows[0];
}

function requireArtifact(ctx: GuardContext, kind: ArtifactKind): void {
  if (headArtifact(ctx.tx, ctx.spec.id, kind) === undefined) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `no ${kind} artifact exists for this spec yet`,
      { spec_id: ctx.spec.id, artifact_kind: kind },
    );
  }
}

/**
 * The hash-binding check — the mechanism behind "approval means something".
 *
 * An approval records the content hash the reviewer saw. Editing the artifact creates
 * a *new* version with a different hash (artifact versions are immutable, enforced by
 * a database trigger), so the stale approval no longer matches the head version and
 * this guard refuses the transition. There is no way to inherit an approval across an
 * edit, which is exactly the loophole the competing tools leave open.
 */
function requireApprovedAndUnchanged(ctx: GuardContext, kind: ArtifactKind): void {
  const head = headArtifact(ctx.tx, ctx.spec.id, kind);
  if (head === undefined) {
    throw new TransitionError('PRECONDITION_FAILED', `no ${kind} artifact exists for this spec`, {
      spec_id: ctx.spec.id,
      artifact_kind: kind,
    });
  }

  const latest = ctx.tx
    .select({
      decision: schema.approvals.decision,
      contentHash: schema.approvals.contentHash,
      artifactVersionId: schema.approvals.artifactVersionId,
      actor: schema.approvals.actor,
    })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.specId, ctx.spec.id), eq(schema.approvals.artifactKind, kind)))
    .orderBy(desc(schema.approvals.createdAt), desc(schema.approvals.id))
    .limit(1)
    .all()[0];

  if (latest === undefined) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `${kind} has never been reviewed; it must be approved first`,
      { spec_id: ctx.spec.id, artifact_kind: kind },
    );
  }

  if (latest.decision !== 'approve') {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `the most recent ${kind} decision was "${latest.decision}", not an approval`,
      { spec_id: ctx.spec.id, artifact_kind: kind, decision: latest.decision },
    );
  }

  if (latest.contentHash !== head.contentHash) {
    throw new TransitionError(
      'HASH_MISMATCH',
      `${kind} was approved at a different content hash than the current version ` +
        `(approved ${latest.contentHash.slice(0, 12)}, current ${head.contentHash.slice(0, 12)}). ` +
        `The artifact changed after approval, so the approval no longer applies.`,
      {
        spec_id: ctx.spec.id,
        artifact_kind: kind,
        approved_hash: latest.contentHash,
        current_hash: head.contentHash,
        current_version: head.version,
      },
    );
  }
}

const IMPLEMENTATIONS: Record<GuardName, (ctx: GuardContext) => void> = {
  mode_is_brownfield: (ctx) => {
    if (ctx.spec.mode !== 'brownfield') {
      throw new TransitionError(
        'PRECONDITION_FAILED',
        'this transition applies only to brownfield specs',
        { spec_id: ctx.spec.id, mode: ctx.spec.mode },
      );
    }
  },

  mode_is_greenfield: (ctx) => {
    if (ctx.spec.mode !== 'greenfield') {
      throw new TransitionError(
        'PRECONDITION_FAILED',
        'this transition applies only to greenfield specs; brownfield specs must scan context first',
        { spec_id: ctx.spec.id, mode: ctx.spec.mode },
      );
    }
  },

  context_artifact_exists: (ctx) => {
    requireArtifact(ctx, 'context');
  },
  requirements_artifact_exists: (ctx) => {
    requireArtifact(ctx, 'requirements');
  },
  design_artifact_exists: (ctx) => {
    requireArtifact(ctx, 'design');
  },
  tasks_artifact_exists: (ctx) => {
    requireArtifact(ctx, 'tasks');
  },

  requirements_approved_and_unchanged: (ctx) => {
    requireApprovedAndUnchanged(ctx, 'requirements');
  },
  design_approved_and_unchanged: (ctx) => {
    requireApprovedAndUnchanged(ctx, 'design');
  },

  clarifications_answered: (ctx) => {
    const unanswered = ctx.tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.clarifications)
      .where(
        and(eq(schema.clarifications.specId, ctx.spec.id), isNull(schema.clarifications.answer)),
      )
      .all()[0];

    const outstanding = unanswered?.count ?? 0;
    if (outstanding > 0) {
      throw new TransitionError(
        'PRECONDITION_FAILED',
        `${String(outstanding)} clarification(s) are still unanswered`,
        { spec_id: ctx.spec.id, outstanding },
      );
    }
  },
};

/** Runs the named guards in order, throwing on the first failure. */
export function runGuards(names: readonly GuardName[], ctx: GuardContext): void {
  for (const name of names) {
    IMPLEMENTATIONS[name](ctx);
  }
}
