import {
  type ContextBundle,
  type ContextEvidence,
  ContextEvidenceSchema,
  type GroundingFailure,
  ValidationError,
  formatId,
} from '@agentforge/contract';
import { type Db, fromSqliteBool, schema, toSqliteBool } from '@agentforge/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { newId } from './ids.ts';

/**
 * Context evidence persistence.
 *
 * The Context Agent proposes claims, a deterministic verifier checks each one against
 * the repository, and the results land here. Unverified rows are *kept*, not discarded:
 * the unverified-claim rate is a headline metric, so the denominator has to survive
 * into the database.
 */

export interface EvidenceInput {
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly symbol: string | null;
  readonly claim: string;
  readonly relevance: string;
  readonly verified: boolean;
  readonly failureReason: GroundingFailure | null;
}

/**
 * Replaces a spec's evidence with the results of a scan.
 *
 * A re-scan supersedes the previous one wholesale rather than merging, so the stored
 * unverified rate always describes a single coherent run — which is what the ablation
 * needs when it scans the same spec under three retrieval strategies.
 */
export function replaceEvidence(
  db: Db,
  specId: string,
  evidence: readonly EvidenceInput[],
): readonly ContextEvidence[] {
  for (const item of evidence) {
    if (item.verified === (item.failureReason !== null)) {
      throw new ValidationError(
        'verified evidence must have no failure reason, and unverified evidence must give one',
        { file: item.file, verified: item.verified, failure_reason: item.failureReason },
      );
    }
    if (item.lineEnd < item.lineStart) {
      throw new ValidationError('lineEnd must be >= lineStart', {
        file: item.file,
        line_start: item.lineStart,
        line_end: item.lineEnd,
      });
    }
  }

  return db.transaction(
    (tx) => {
      tx.delete(schema.contextEvidence).where(eq(schema.contextEvidence.specId, specId)).run();

      const now = new Date().toISOString();
      const stored: ContextEvidence[] = [];

      evidence.forEach((item, index) => {
        const evidenceKey = formatId('EV', index + 1);
        tx.insert(schema.contextEvidence)
          .values({
            id: newId('ev'),
            specId,
            evidenceKey,
            file: item.file,
            lineStart: item.lineStart,
            lineEnd: item.lineEnd,
            symbol: item.symbol,
            claim: item.claim,
            relevance: item.relevance,
            verified: toSqliteBool(item.verified),
            failureReason: item.failureReason,
            createdAt: now,
          })
          .run();

        stored.push(
          ContextEvidenceSchema.parse({
            id: evidenceKey,
            file: item.file,
            line_start: item.lineStart,
            line_end: item.lineEnd,
            symbol: item.symbol,
            claim: item.claim,
            relevance: item.relevance,
            verified: item.verified,
            failure_reason: item.failureReason,
          }),
        );
      });

      return stored;
    },
    { behavior: 'immediate' },
  );
}

/** Every evidence row for a spec, in key order. */
export function listEvidence(db: Db, specId: string): readonly ContextEvidence[] {
  return db
    .select()
    .from(schema.contextEvidence)
    .where(eq(schema.contextEvidence.specId, specId))
    .orderBy(asc(schema.contextEvidence.evidenceKey))
    .all()
    .map((row) =>
      ContextEvidenceSchema.parse({
        id: row.evidenceKey,
        file: row.file,
        line_start: row.lineStart,
        line_end: row.lineEnd,
        symbol: row.symbol,
        claim: row.claim,
        relevance: row.relevance,
        verified: fromSqliteBool(row.verified),
        failure_reason: row.failureReason,
      }),
    );
}

export interface EvidenceStats {
  readonly total: number;
  readonly verified: number;
  readonly unverified: number;
  /** `unverified / total`, defined as 0 when there are no claims. */
  readonly unverifiedClaimRate: number;
}

/**
 * The unverified-claim rate: this project's hallucination metric.
 *
 * Reported per spec and aggregated across the eval suite. Defined as 0 for an empty
 * set so a greenfield spec, which makes no codebase claims, does not look like a
 * perfect score on a metric it never attempted.
 */
export function evidenceStats(db: Db, specId: string): EvidenceStats {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      verified: sql<number>`sum(${schema.contextEvidence.verified})`,
    })
    .from(schema.contextEvidence)
    .where(eq(schema.contextEvidence.specId, specId))
    .all()[0];

  const total = row?.total ?? 0;
  const verified = row?.verified ?? 0;
  const unverified = total - verified;

  return {
    total,
    verified,
    unverified,
    unverifiedClaimRate: total === 0 ? 0 : unverified / total,
  };
}

/** Only the verified rows. Requirements and design may cite nothing else. */
export function listVerifiedEvidence(db: Db, specId: string): readonly ContextEvidence[] {
  return db
    .select()
    .from(schema.contextEvidence)
    .where(and(eq(schema.contextEvidence.specId, specId), eq(schema.contextEvidence.verified, 1)))
    .orderBy(asc(schema.contextEvidence.evidenceKey))
    .all()
    .map((row) =>
      ContextEvidenceSchema.parse({
        id: row.evidenceKey,
        file: row.file,
        line_start: row.lineStart,
        line_end: row.lineEnd,
        symbol: row.symbol,
        claim: row.claim,
        relevance: row.relevance,
        verified: true,
        failure_reason: null,
      }),
    );
}

/** Assembles the persisted `context.json` bundle for a spec. */
export function buildContextBundle(
  db: Db,
  specId: string,
  meta: {
    readonly summary: string;
    readonly touchedModules: readonly string[];
    readonly openQuestions: readonly string[];
    readonly toolCallsUsed: number;
    readonly retrievalStrategy: string;
  },
): ContextBundle {
  const evidence = listEvidence(db, specId);
  const stats = evidenceStats(db, specId);

  return {
    spec_id: specId,
    summary: meta.summary,
    evidence: [...evidence],
    touched_modules: [...meta.touchedModules],
    open_questions: [...meta.openQuestions],
    stats: {
      total_claims: stats.total,
      verified_claims: stats.verified,
      unverified_claims: stats.unverified,
      unverified_claim_rate: stats.unverifiedClaimRate,
      tool_calls_used: meta.toolCallsUsed,
      retrieval_strategy: meta.retrievalStrategy,
    },
  };
}
