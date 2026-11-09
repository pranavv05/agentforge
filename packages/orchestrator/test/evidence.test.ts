import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentForgeError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  buildContextBundle,
  evidenceStats,
  listEvidence,
  listVerifiedEvidence,
  replaceEvidence,
  type EvidenceInput,
} from '../src/index.ts';
import { makeSpec, makeTestDb, type TestDb } from './helpers.ts';

/**
 * Context evidence and the unverified-claim rate.
 *
 * The rate is a headline metric, so the arithmetic and — more importantly — the
 * *retention* of failed claims are pinned here. Discarding unverified evidence would
 * make every run look perfect, which is precisely the failure this metric exists to
 * expose.
 */

let ctx: TestDb;
let db: Db;

const verified = (file: string, claim: string): EvidenceInput => ({
  file,
  lineStart: 1,
  lineEnd: 10,
  symbol: 'thing',
  claim,
  relevance: 'relevant',
  verified: true,
  failureReason: null,
});

const unverified = (file: string): EvidenceInput => ({
  file,
  lineStart: 1,
  lineEnd: 10,
  symbol: 'invented',
  claim: 'a plausible but false claim',
  relevance: 'would be relevant if it existed',
  verified: false,
  failureReason: 'file_not_found',
});

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => {
  ctx.cleanup();
});

describe('replaceEvidence', () => {
  it('stores evidence with generated EV keys in order', () => {
    const spec = makeSpec(db, 'brownfield');
    const stored = replaceEvidence(db, spec.id, [
      verified('a.ts', 'first'),
      verified('b.ts', 'second'),
    ]);

    expect(stored.map((e) => e.id)).toEqual(['EV-001', 'EV-002']);
    expect(listEvidence(db, spec.id).map((e) => e.claim)).toEqual(['first', 'second']);
  });

  it('keeps unverified claims rather than dropping them', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [verified('a.ts', 'real'), unverified('imaginary.ts')]);

    const all = listEvidence(db, spec.id);
    expect(all).toHaveLength(2);
    expect(all.find((row) => !row.verified)?.failure_reason).toBe('file_not_found');
  });

  it('supersedes a previous scan wholesale', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [verified('a.ts', 'old'), verified('b.ts', 'old too')]);
    replaceEvidence(db, spec.id, [verified('c.ts', 'new')]);

    // A re-scan under a different retrieval strategy must not blend with the last one,
    // or the reported rate would describe no single run.
    const all = listEvidence(db, spec.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('EV-001');
    expect(all[0]?.claim).toBe('new');
  });

  it('accepts an empty scan', () => {
    const spec = makeSpec(db, 'brownfield');
    expect(replaceEvidence(db, spec.id, [])).toEqual([]);
    expect(evidenceStats(db, spec.id).total).toBe(0);
  });

  it('rejects verified evidence that also carries a failure reason', () => {
    const spec = makeSpec(db, 'brownfield');
    expect(() =>
      replaceEvidence(db, spec.id, [
        { ...verified('a.ts', 'x'), failureReason: 'symbol_not_in_range' },
      ]),
    ).toThrow(/must have no failure reason/);
  });

  it('rejects unverified evidence with no failure reason', () => {
    const spec = makeSpec(db, 'brownfield');
    expect(() =>
      replaceEvidence(db, spec.id, [{ ...unverified('a.ts'), failureReason: null }]),
    ).toThrow(/must give one/);
  });

  it('rejects an inverted line range', () => {
    const spec = makeSpec(db, 'brownfield');
    try {
      replaceEvidence(db, spec.id, [{ ...verified('a.ts', 'x'), lineStart: 20, lineEnd: 5 }]);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('writes nothing when any item in the batch is invalid', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [verified('kept.ts', 'kept')]);

    expect(() =>
      replaceEvidence(db, spec.id, [
        verified('new.ts', 'fine'),
        { ...verified('bad.ts', 'x'), lineStart: 9, lineEnd: 2 },
      ]),
    ).toThrow();

    // Validation runs before the delete, so the previous scan survives intact.
    expect(listEvidence(db, spec.id).map((e) => e.claim)).toEqual(['kept']);
  });
});

describe('evidenceStats', () => {
  it('computes the unverified-claim rate', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [
      verified('a.ts', '1'),
      verified('b.ts', '2'),
      verified('c.ts', '3'),
      verified('d.ts', '4'),
      unverified('e.ts'),
    ]);

    const stats = evidenceStats(db, spec.id);
    expect(stats.total).toBe(5);
    expect(stats.verified).toBe(4);
    expect(stats.unverified).toBe(1);
    expect(stats.unverifiedClaimRate).toBeCloseTo(0.2, 12);
  });

  it('reports zero for a spec that made no claims', () => {
    const spec = makeSpec(db);
    const stats = evidenceStats(db, spec.id);

    expect(stats.total).toBe(0);
    // Defined as 0, not 1 and not NaN: a greenfield spec attempted no claims and must
    // not appear to have scored perfectly on a metric it never ran.
    expect(stats.unverifiedClaimRate).toBe(0);
  });

  it('reports a rate of 1 when every claim failed', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [unverified('a.ts'), unverified('b.ts')]);
    expect(evidenceStats(db, spec.id).unverifiedClaimRate).toBe(1);
  });
});

describe('listVerifiedEvidence', () => {
  it('returns only the verified rows', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [
      verified('a.ts', 'real'),
      unverified('ghost.ts'),
      verified('b.ts', 'also real'),
    ]);

    const rows = listVerifiedEvidence(db, spec.id);
    expect(rows.map((r) => r.file)).toEqual(['a.ts', 'b.ts']);
    expect(rows.every((r) => r.verified)).toBe(true);
    expect(rows.every((r) => r.failure_reason === null)).toBe(true);
  });
});

describe('buildContextBundle', () => {
  it('assembles the bundle with consistent stats', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [verified('a.ts', 'real'), unverified('ghost.ts')]);

    const bundle = buildContextBundle(db, spec.id, {
      summary: 'What the agent found.',
      touchedModules: ['packages/orchestrator'],
      openQuestions: ['Is there a vendor master?'],
      toolCallsUsed: 17,
      retrievalStrategy: 'fts_repomap',
    });

    expect(bundle.spec_id).toBe(spec.id);
    expect(bundle.evidence).toHaveLength(2);
    expect(bundle.stats.total_claims).toBe(2);
    expect(bundle.stats.verified_claims).toBe(1);
    expect(bundle.stats.unverified_claim_rate).toBe(0.5);
    expect(bundle.stats.tool_calls_used).toBe(17);
    expect(bundle.stats.retrieval_strategy).toBe('fts_repomap');

    // The stats must agree with the evidence array they summarise.
    expect(bundle.stats.verified_claims).toBe(bundle.evidence.filter((e) => e.verified).length);
  });

  it('records the tool-call budget actually consumed', () => {
    const spec = makeSpec(db, 'brownfield');
    replaceEvidence(db, spec.id, [verified('a.ts', 'x')]);

    const bundle = buildContextBundle(db, spec.id, {
      summary: 's',
      touchedModules: [],
      openQuestions: [],
      toolCallsUsed: 25,
      retrievalStrategy: 'grep',
    });

    expect(bundle.stats.tool_calls_used).toBe(25);
    expect(bundle.touched_modules).toEqual([]);
  });
});
