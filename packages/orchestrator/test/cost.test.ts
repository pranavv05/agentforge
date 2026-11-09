import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentForgeError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  assertWithinBudget,
  computeCost,
  getCostSummary,
  recordLlmCall,
  spentOnSpec,
} from '../src/index.ts';
import { makeSpec, makeTestDb, type TestDb } from './helpers.ts';

/**
 * Cost accounting.
 *
 * These numbers are claims the report will make, so the arithmetic is pinned here. In
 * particular the prompt-caching saving and the Haiku long-context cliff are the two
 * facts the whole retrieval design is built around.
 *
 * Note the token counts below are deliberately kept *under* 100K where a base-band
 * rate is being asserted: Haiku 5.5 prices prompts above that threshold five times
 * higher, so a 1M-token figure would silently be testing the expensive band.
 */

let ctx: TestDb;
let db: Db;
const CORRELATION = 'run_test';

/** Convenience: a usage record with everything zeroed but the named fields. */
const usage = (fields: Partial<Parameters<typeof computeCost>[1]>) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  ...fields,
});

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  process.env['SDD_RUN_COST_CAP_USD'] = '2.00';
});

afterEach(() => {
  ctx.cleanup();
  delete process.env['SDD_RUN_COST_CAP_USD'];
});

describe('computeCost — base band', () => {
  it('prices uncached Haiku input at $0.10/MTok and output at $0.50/MTok', () => {
    const cost = computeCost(
      'claude-haiku-5-5',
      usage({ inputTokens: 50_000, outputTokens: 50_000 }),
    );
    // 50K x $0.10/MTok + 50K x $0.50/MTok
    expect(cost).toBeCloseTo((50_000 * 0.1 + 50_000 * 0.5) / 1_000_000, 12);
    expect(cost).toBeCloseTo(0.03, 12);
  });

  it('prices a cache read at a tenth of the input rate', () => {
    const cached = computeCost('claude-haiku-5-5', usage({ cacheReadInputTokens: 50_000 }));
    const uncached = computeCost('claude-haiku-5-5', usage({ inputTokens: 50_000 }));

    expect(cached).toBeCloseTo(0.0005, 12);
    expect(cached).toBeCloseTo(uncached / 10, 12);
  });

  it('charges 1.25x for a 5-minute cache write and 2x for a 1-hour write', () => {
    const fiveMin = computeCost(
      'claude-haiku-5-5',
      usage({ cacheCreationInputTokens: 50_000, cacheTtl: '5m' }),
    );
    const oneHour = computeCost(
      'claude-haiku-5-5',
      usage({ cacheCreationInputTokens: 50_000, cacheTtl: '1h' }),
    );
    expect(fiveMin).toBeCloseTo((50_000 * 0.1 * 1.25) / 1_000_000, 12);
    expect(oneHour).toBeCloseTo((50_000 * 0.1 * 2) / 1_000_000, 12);
  });

  it('repays a 5-minute cache write after one read, and a 1-hour write after two', () => {
    // The documented break-even arithmetic. Sending a prefix uncached costs 1x the
    // input rate each time; a 5m write costs 1.25x and a 1h write 2x, with reads at
    // 0.1x. So for N sends: cached = write + (N-1) x read, uncached = N x send.
    const send = computeCost('claude-haiku-5-5', usage({ inputTokens: 50_000 }));
    const read = computeCost('claude-haiku-5-5', usage({ cacheReadInputTokens: 50_000 }));
    const write5m = computeCost(
      'claude-haiku-5-5',
      usage({ cacheCreationInputTokens: 50_000, cacheTtl: '5m' }),
    );
    const write1h = computeCost(
      'claude-haiku-5-5',
      usage({ cacheCreationInputTokens: 50_000, cacheTtl: '1h' }),
    );

    // Two sends: the 5-minute cache is already cheaper, the 1-hour cache is not yet.
    expect(write5m + read).toBeLessThan(2 * send);
    expect(write1h + read).toBeGreaterThan(2 * send);

    // Three sends: the 1-hour cache has caught up.
    expect(write1h + 2 * read).toBeLessThan(3 * send);

    // A single send never justifies either write, which is why a cache is pointless
    // across a human approval gate: the reviewer outlasts the 5-minute TTL and the
    // next call rebuilds the prefix from the persisted context bundle anyway.
    expect(write5m).toBeGreaterThan(send);
    expect(write1h).toBeGreaterThan(send);
  });

  it('demonstrates the ~83% saving from reusing a cached prefix', () => {
    // A 50K-token prefix sent 10 times: once written, nine times read, versus ten
    // uncached sends.
    const prefix = 50_000;
    const uncached = 10 * computeCost('claude-sonnet-5-5', usage({ inputTokens: prefix }));
    const cached =
      computeCost('claude-sonnet-5-5', usage({ cacheCreationInputTokens: prefix })) +
      9 * computeCost('claude-sonnet-5-5', usage({ cacheReadInputTokens: prefix }));

    expect(uncached).toBeCloseTo(1.0, 10);
    expect(cached / uncached).toBeLessThan(0.2);
  });
});

describe('computeCost — long-context band', () => {
  it('crosses into the Haiku long-context band above a 100K-token prompt', () => {
    const below = computeCost('claude-haiku-5-5', usage({ inputTokens: 100_000 }));
    const above = computeCost('claude-haiku-5-5', usage({ inputTokens: 100_001 }));

    expect(below).toBeCloseTo(0.01, 12);
    // 5x the rate the moment the prompt exceeds the threshold. This cliff is the reason
    // the agentic loop caps its prompt below 100K.
    expect(above / below).toBeGreaterThan(4.9);
  });

  it('counts cache tokens towards the long-context threshold', () => {
    // A large cached prefix still puts the request in the expensive band.
    const cost = computeCost(
      'claude-haiku-5-5',
      usage({ inputTokens: 1_000, cacheReadInputTokens: 150_000 }),
    );
    expect(cost).toBeCloseTo((1_000 * 0.5 + 150_000 * 0.05) / 1_000_000, 12);
  });

  it('erodes most of Haiku’s advantage over Sonnet once the prompt exceeds 100K', () => {
    // Under the threshold Haiku is roughly 20x cheaper...
    const small = usage({
      inputTokens: 20_000,
      outputTokens: 5_000,
      cacheReadInputTokens: 60_000,
      cacheCreationInputTokens: 10_000,
    });
    const smallRatio =
      computeCost('claude-sonnet-5-5', small) / computeCost('claude-haiku-5-5', small);

    // ...but above it, Haiku pays 5x while Sonnet's rate is flat, so the gap collapses
    // to roughly 3.5x. This is the quantitative justification for the <100K prompt cap:
    // without it, the cheap model stops being cheap.
    const large = usage({
      inputTokens: 80_000,
      outputTokens: 15_000,
      cacheReadInputTokens: 720_000,
      cacheCreationInputTokens: 40_000,
    });
    const largeRatio =
      computeCost('claude-sonnet-5-5', large) / computeCost('claude-haiku-5-5', large);

    expect(smallRatio).toBeGreaterThan(15);
    expect(largeRatio).toBeLessThan(5);
    expect(largeRatio).toBeGreaterThan(3);
    expect(smallRatio / largeRatio).toBeGreaterThan(4);
  });
});

describe('computeCost — other models and modes', () => {
  it('halves the total for a Batch API request', () => {
    const u = usage({ inputTokens: 50_000 });
    expect(computeCost('claude-haiku-5-5', { ...u, batch: true })).toBeCloseTo(
      computeCost('claude-haiku-5-5', u) / 2,
      12,
    );
  });

  it('prices Sonnet and Opus at their flat list rates with no band', () => {
    // Both are flat-rate, so a 1M-token prompt is priced at the same per-token rate.
    expect(computeCost('claude-sonnet-5-5', usage({ inputTokens: 1_000_000 }))).toBeCloseTo(2, 10);
    expect(computeCost('claude-opus-5-5', usage({ inputTokens: 1_000_000 }))).toBeCloseTo(4, 10);
    expect(computeCost('claude-opus-5-5', usage({ outputTokens: 1_000_000 }))).toBeCloseTo(20, 10);
  });

  it('confirms Haiku 5.5 is an order of magnitude cheaper than Haiku 4.5', () => {
    const u = usage({ inputTokens: 50_000, outputTokens: 10_000 });
    expect(computeCost('claude-haiku-4-5', u) / computeCost('claude-haiku-5-5', u)).toBeCloseTo(
      10,
      6,
    );
  });

  it('charges nothing for an empty request', () => {
    expect(computeCost('claude-haiku-5-5', usage({}))).toBe(0);
  });

  it('refuses an unknown model rather than guessing a price', () => {
    expect(() => computeCost('claude-made-up-9', usage({ inputTokens: 1 }))).toThrow(
      /no pricing entry/,
    );
  });
});

describe('recording calls', () => {
  it('accumulates spend per spec', () => {
    const spec = makeSpec(db);

    recordLlmCall(db, {
      specId: spec.id,
      stage: 'context_loop',
      model: 'claude-haiku-5-5',
      usage: usage({ inputTokens: 50_000 }),
      latencyMs: 1200,
      fromCassette: false,
      correlationId: CORRELATION,
    });

    expect(spentOnSpec(db, spec.id)).toBeCloseTo(0.005, 12);
  });

  it('costs nothing for a cassette replay', () => {
    const spec = makeSpec(db);
    const cost = recordLlmCall(db, {
      specId: spec.id,
      stage: 'requirements',
      model: 'claude-sonnet-5-5',
      usage: usage({ inputTokens: 500_000, outputTokens: 50_000 }),
      latencyMs: 3,
      fromCassette: true,
      correlationId: CORRELATION,
    });

    expect(cost).toBe(0);
    expect(spentOnSpec(db, spec.id)).toBe(0);
  });

  it('reports zero spend for a spec with no calls', () => {
    const spec = makeSpec(db);
    expect(spentOnSpec(db, spec.id)).toBe(0);
  });
});

describe('budget ceiling', () => {
  it('permits a call that stays within the cap', () => {
    const spec = makeSpec(db);
    expect(() => {
      assertWithinBudget(db, spec.id, 0.5, CORRELATION);
    }).not.toThrow();
  });

  it('refuses the call that would breach the cap, before it is issued', () => {
    const spec = makeSpec(db);

    recordLlmCall(db, {
      specId: spec.id,
      stage: 'context_loop',
      model: 'claude-sonnet-5-5',
      usage: usage({ inputTokens: 900_000 }),
      latencyMs: 10,
      fromCassette: false,
      correlationId: CORRELATION,
    });
    expect(spentOnSpec(db, spec.id)).toBeCloseTo(1.8, 6);

    try {
      assertWithinBudget(db, spec.id, 0.5, CORRELATION);
      throw new Error('expected BUDGET_EXCEEDED');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('BUDGET_EXCEEDED');
      expect(e.status).toBe(402);
      expect(e.message).toContain('would exceed');
    }
  });

  it('rejects a malformed cap rather than running uncapped', () => {
    process.env['SDD_RUN_COST_CAP_USD'] = 'not-a-number';
    const spec = makeSpec(db);
    expect(() => {
      assertWithinBudget(db, spec.id, 0.01, CORRELATION);
    }).toThrow(/must be a positive number/);
  });

  it('rejects a zero or negative cap', () => {
    process.env['SDD_RUN_COST_CAP_USD'] = '0';
    const spec = makeSpec(db);
    expect(() => {
      assertWithinBudget(db, spec.id, 0.01, CORRELATION);
    }).toThrow(/must be a positive number/);
  });
});

describe('cost summary', () => {
  it('reports totals, per-stage breakdown and the cache hit rate', () => {
    const spec = makeSpec(db);

    recordLlmCall(db, {
      specId: spec.id,
      stage: 'context_loop',
      model: 'claude-haiku-5-5',
      usage: usage({ inputTokens: 10_000, outputTokens: 2_000, cacheReadInputTokens: 90_000 }),
      latencyMs: 900,
      fromCassette: false,
      correlationId: CORRELATION,
    });
    recordLlmCall(db, {
      specId: spec.id,
      stage: 'requirements',
      model: 'claude-haiku-5-5',
      usage: usage({ inputTokens: 5_000, outputTokens: 1_000 }),
      latencyMs: 700,
      fromCassette: false,
      correlationId: CORRELATION,
    });

    const summary = getCostSummary(db, spec.id);

    expect(summary.call_count).toBe(2);
    expect(summary.total_input_tokens).toBe(15_000);
    expect(summary.total_output_tokens).toBe(3_000);
    expect(summary.total_cache_read_tokens).toBe(90_000);
    expect(summary.cap_usd).toBe(2);
    // 90K of 105K billable input tokens came from cache.
    expect(summary.cache_hit_rate).toBeCloseTo(90_000 / 105_000, 12);

    expect(summary.by_stage.map((s) => s.stage)).toEqual(['context_loop', 'requirements']);
    expect(summary.total_cost_usd).toBeCloseTo(
      summary.by_stage.reduce((sum, s) => sum + s.cost_usd, 0),
      12,
    );
  });

  it('reports a zeroed summary for a spec with no calls', () => {
    const spec = makeSpec(db);
    const summary = getCostSummary(db, spec.id);

    expect(summary.call_count).toBe(0);
    expect(summary.total_cost_usd).toBe(0);
    // Guards against a divide-by-zero slipping into the UI.
    expect(summary.cache_hit_rate).toBe(0);
    expect(summary.by_stage).toEqual([]);
  });
});
