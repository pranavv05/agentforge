import { describe, expect, it } from 'vitest';
import {
  formatDistribution,
  normalisePath,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  summarise,
} from '../src/index.ts';

/**
 * The scoring functions.
 *
 * These produce the only numbers in the report that claim to be measurements, so they
 * are pinned against hand-computed values rather than against whatever they currently
 * return. Several cases here are the ones where a plausible implementation is silently
 * wrong: duplicate retrievals, an empty gold set, a single observation.
 */

describe('recall@k', () => {
  it('is the fraction of gold files inside the first k', () => {
    const retrieved = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const gold = ['b.ts', 'd.ts', 'e.ts'];

    expect(recallAtK(retrieved, gold, 2)).toBeCloseTo(1 / 3);
    expect(recallAtK(retrieved, gold, 4)).toBeCloseTo(2 / 3);
    // e.ts was never retrieved, so even unlimited depth cannot reach 1.
    expect(recallAtK(retrieved, gold, 100)).toBeCloseTo(2 / 3);
  });

  it('counts k as distinct paths, so a duplicate does not consume a slot', () => {
    // The documented definition: duplicates are collapsed, then the top k taken. Every
    // arm builds its ranking from a map keyed by path and so cannot repeat itself, which
    // makes this irrelevant to the reported figures — but it still has to be pinned,
    // because the alternative reading ("the first k results") gives a different answer.
    expect(recallAtK(['a.ts', 'a.ts', 'a.ts', 'b.ts'], ['b.ts'], 2)).toBe(1);
    expect(recallAtK(['a.ts', 'b.ts'], ['b.ts'], 2)).toBe(1);
    // And a path genuinely outside the top k distinct entries is still missed.
    expect(recallAtK(['a.ts', 'a.ts', 'b.ts'], ['b.ts'], 1)).toBe(0);
  });

  it('is zero for an empty gold set rather than one', () => {
    // Vacuously perfect is the wrong answer: an unscorable commit must not count as a
    // success. The runner drops these, and this is the backstop.
    expect(recallAtK(['a.ts'], [], 10)).toBe(0);
  });

  it('is zero when nothing was retrieved', () => {
    expect(recallAtK([], ['a.ts'], 10)).toBe(0);
  });

  it('counts a duplicated gold file once in the denominator', () => {
    expect(recallAtK(['a.ts'], ['a.ts', 'a.ts'], 10)).toBe(1);
  });

  it('matches across path separators', () => {
    // Gold comes from git with forward slashes; an inventory on Windows may not.
    expect(recallAtK(['src\\a.ts'], ['src/a.ts'], 10)).toBe(1);
    expect(recallAtK(['./src/a.ts'], ['src/a.ts'], 10)).toBe(1);
  });
});

describe('precision@k', () => {
  it('is the fraction of the first k that are gold', () => {
    expect(precisionAtK(['a.ts', 'b.ts', 'c.ts', 'd.ts'], ['b.ts', 'd.ts'], 4)).toBe(0.5);
  });

  it('divides by what was actually returned, not by k', () => {
    // Two returned against k=10 and both correct is precision 1, not 0.2. Dividing by k
    // would penalise a retriever for being appropriately short.
    expect(precisionAtK(['a.ts', 'b.ts'], ['a.ts', 'b.ts'], 10)).toBe(1);
  });

  it('is zero when nothing was returned', () => {
    expect(precisionAtK([], ['a.ts'], 10)).toBe(0);
  });
});

describe('reciprocal rank', () => {
  it('is one over the rank of the first gold file', () => {
    expect(reciprocalRank(['a.ts', 'b.ts', 'c.ts'], ['c.ts'])).toBeCloseTo(1 / 3);
    expect(reciprocalRank(['c.ts', 'a.ts'], ['c.ts'])).toBe(1);
  });

  it('is zero when no gold file appears', () => {
    expect(reciprocalRank(['a.ts'], ['z.ts'])).toBe(0);
  });

  it('distinguishes a ranking recall@10 cannot', () => {
    // Both have recall@10 of 1, but one put the answer first. An agent spending a finite
    // tool budget cares a great deal about the difference.
    const gold = ['target.ts'];
    const first = ['target.ts', ...Array.from({ length: 9 }, (_, i) => `n${String(i)}.ts`)];
    const last = [...Array.from({ length: 9 }, (_, i) => `n${String(i)}.ts`), 'target.ts'];

    expect(recallAtK(first, gold, 10)).toBe(recallAtK(last, gold, 10));
    expect(reciprocalRank(first, gold)).toBeGreaterThan(reciprocalRank(last, gold));
  });
});

describe('summarise', () => {
  it('computes mean, median and sample standard deviation', () => {
    const dist = summarise([2, 4, 4, 4, 5, 5, 7, 9]);

    expect(dist.n).toBe(8);
    expect(dist.mean).toBe(5);
    expect(dist.median).toBe(4.5);
    expect(dist.min).toBe(2);
    expect(dist.max).toBe(9);
    // Sample (n-1) standard deviation of this set is 2.138…, not the population 2.
    expect(dist.stdev).toBeCloseTo(2.138, 3);
  });

  it('takes the midpoint for an even count', () => {
    expect(summarise([1, 2, 3, 4]).median).toBe(2.5);
  });

  it('reports no spread for a single observation rather than dividing by zero', () => {
    const dist = summarise([0.5]);
    expect(dist.n).toBe(1);
    expect(dist.mean).toBe(0.5);
    expect(dist.stdev).toBe(0);
  });

  it('handles an empty set without producing NaN', () => {
    const dist = summarise([]);
    expect(dist.n).toBe(0);
    expect(Number.isNaN(dist.mean)).toBe(false);
    expect(dist.mean).toBe(0);
  });
});

describe('formatting', () => {
  it('names a single run for what it is instead of printing ± 0.000', () => {
    // "0.500 ± 0.000" from one observation reads as precision. It is not.
    expect(formatDistribution(summarise([0.5]))).toContain('single run');
  });

  it('shows mean, spread and n for a real sample', () => {
    expect(formatDistribution(summarise([0.4, 0.6]))).toMatch(/0\.500 ± 0\.141 \(n=2\)/);
  });

  it('says so when there is no data', () => {
    expect(formatDistribution(summarise([]))).toBe('no data');
  });
});

describe('path normalisation', () => {
  it('unifies separators and strips a leading ./', () => {
    expect(normalisePath('src\\a\\b.ts')).toBe('src/a/b.ts');
    expect(normalisePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalisePath('src/a.ts')).toBe('src/a.ts');
  });
});
