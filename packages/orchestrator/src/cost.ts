import {
  BudgetExceededError,
  type CostSummary,
  type LlmStage,
  LLM_STAGES,
  ValidationError,
} from '@agentforge/contract';
import { type Db, schema } from '@agentforge/db';
import { eq, sql } from 'drizzle-orm';
import { newId } from './ids.ts';
import { runLogger } from './logger.ts';

/**
 * Token accounting and the spend ceiling.
 *
 * Two jobs:
 *
 * 1. **Measure.** Every call's token and cache counters are written to `llm_calls`.
 *    The source document's per-feature costs are estimates; week one replaces them
 *    with numbers from this table, and the claim that caching saves ~90% on the context
 *    step is only defensible because `cache_read_input_tokens` is recorded here.
 *
 * 2. **Cap.** `assertWithinBudget` is checked *before* a call is issued, so a runaway
 *    agentic loop fails closed rather than discovering the overspend afterwards.
 *
 * Prices are list prices per million tokens, transcribed from Anthropic's pricing page.
 * They are data, not logic: when they change, only this table changes.
 */

export interface ModelPricing {
  /** USD per million input tokens. */
  readonly input: number;
  /** USD per million output tokens. */
  readonly output: number;
  /** USD per million tokens read from cache. */
  readonly cacheRead: number;
  /**
   * Long-context band, when the model prices large prompts differently.
   *
   * Haiku 5.5 charges 5x above a 100K-token prompt, which is exactly why the Context
   * Agent keeps its prompt under that threshold — the cap is a cost-band decision, not
   * an arbitrary limit.
   */
  readonly longContext?: {
    readonly thresholdTokens: number;
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
  };
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    longContext: { thresholdTokens: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/**
 * Cache-write multipliers against the base input rate.
 *
 * A 5-minute write pays for itself after one read; a 1-hour write needs two. Reviewers
 * take longer than five minutes, so we never try to hold a cache across an approval
 * gate — see the context bundle persistence instead.
 */
export const CACHE_WRITE_MULTIPLIER = { '5m': 1.25, '1h': 2 } as const;

export type CacheTtl = keyof typeof CACHE_WRITE_MULTIPLIER;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  /** Which TTL the cache write used. Defaults to the 5-minute cache. */
  readonly cacheTtl?: CacheTtl;
  /** Batch API requests are half price on every token class. */
  readonly batch?: boolean;
}

/** Dollars for one call. Returns 0 for a cassette replay, which costs nothing. */
export function computeCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (pricing === undefined) {
    throw new ValidationError(
      `no pricing entry for model "${model}"; add it to MODEL_PRICING before using it`,
      { model, known_models: Object.keys(MODEL_PRICING) },
    );
  }

  const promptTokens =
    usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;

  const band =
    pricing.longContext !== undefined && promptTokens > pricing.longContext.thresholdTokens
      ? pricing.longContext
      : pricing;

  const writeMultiplier = CACHE_WRITE_MULTIPLIER[usage.cacheTtl ?? '5m'];

  const dollars =
    (usage.inputTokens * band.input +
      usage.cacheCreationInputTokens * band.input * writeMultiplier +
      usage.cacheReadInputTokens * band.cacheRead +
      usage.outputTokens * band.output) /
    1_000_000;

  return (usage.batch ?? false) ? dollars / 2 : dollars;
}

export interface RecordLlmCallInput {
  readonly specId: string | null;
  readonly stage: LlmStage;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly fromCassette: boolean;
  readonly correlationId: string;
}

/** Writes one call to `llm_calls` and returns the dollars it cost. */
export function recordLlmCall(db: Db, input: RecordLlmCallInput): number {
  const costUsd = input.fromCassette ? 0 : computeCost(input.model, input.usage);

  db.insert(schema.llmCalls)
    .values({
      id: newId('llm'),
      specId: input.specId,
      stage: input.stage,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadInputTokens: input.usage.cacheReadInputTokens,
      cacheCreationInputTokens: input.usage.cacheCreationInputTokens,
      costUsd,
      latencyMs: input.latencyMs,
      fromCassette: input.fromCassette ? 1 : 0,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    })
    .run();

  return costUsd;
}

/** The configured per-run ceiling. */
export function budgetCapUsd(): number {
  const raw = process.env['SDD_RUN_COST_CAP_USD'] ?? '2.00';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`SDD_RUN_COST_CAP_USD must be a positive number, received "${raw}"`, {
      value: raw,
    });
  }
  return parsed;
}

/** Dollars spent on a spec so far. */
export function spentOnSpec(db: Db, specId: string): number {
  const row = db
    .select({ total: sql<number | null>`sum(${schema.llmCalls.costUsd})` })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.specId, specId))
    .all()[0];

  return row?.total ?? 0;
}

/**
 * Fails closed if issuing a call would breach the ceiling.
 *
 * Called before the request, with the caller's own estimate of what the call will cost.
 * An estimate is enough: the point is to stop a loop that has already spent its budget,
 * not to predict the next call to the cent.
 */
export function assertWithinBudget(
  db: Db,
  specId: string,
  estimatedCostUsd: number,
  correlationId: string,
): void {
  const cap = budgetCapUsd();
  const spent = spentOnSpec(db, specId);
  const projected = spent + estimatedCostUsd;

  if (projected > cap) {
    runLogger(correlationId, { spec_id: specId }).warn(
      { spent, estimated: estimatedCostUsd, cap },
      'budget ceiling would be exceeded; refusing the call',
    );
    throw new BudgetExceededError(
      `this run has spent $${spent.toFixed(4)} and the next call is estimated at ` +
        `$${estimatedCostUsd.toFixed(4)}, which would exceed the $${cap.toFixed(2)} cap`,
      { spec_id: specId, spent_usd: spent, estimated_usd: estimatedCostUsd, cap_usd: cap },
    );
  }
}

/** Rolled-up spend for one spec, shaped for the cost meter in the UI. */
export function getCostSummary(db: Db, specId: string): CostSummary {
  const totals = db
    .select({
      callCount: sql<number>`count(*)`,
      cost: sql<number | null>`sum(${schema.llmCalls.costUsd})`,
      input: sql<number | null>`sum(${schema.llmCalls.inputTokens})`,
      output: sql<number | null>`sum(${schema.llmCalls.outputTokens})`,
      cacheRead: sql<number | null>`sum(${schema.llmCalls.cacheReadInputTokens})`,
      cacheCreation: sql<number | null>`sum(${schema.llmCalls.cacheCreationInputTokens})`,
    })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.specId, specId))
    .all()[0];

  const byStageRows = db
    .select({
      stage: schema.llmCalls.stage,
      cost: sql<number | null>`sum(${schema.llmCalls.costUsd})`,
      callCount: sql<number>`count(*)`,
    })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.specId, specId))
    .groupBy(schema.llmCalls.stage)
    .all();

  const inputTokens = totals?.input ?? 0;
  const cacheRead = totals?.cacheRead ?? 0;
  const cacheCreation = totals?.cacheCreation ?? 0;
  const billableInput = inputTokens + cacheRead + cacheCreation;

  // Keep the declared stage order rather than SQL's grouping order, so the UI is stable.
  const stageOrder = new Map(LLM_STAGES.map((s, i) => [s, i] as const));
  const byStage = byStageRows
    .map((r) => ({ stage: r.stage, cost_usd: r.cost ?? 0, call_count: r.callCount }))
    .sort((a, b) => (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0));

  return {
    spec_id: specId,
    total_cost_usd: totals?.cost ?? 0,
    cap_usd: budgetCapUsd(),
    call_count: totals?.callCount ?? 0,
    total_input_tokens: inputTokens,
    total_output_tokens: totals?.output ?? 0,
    total_cache_read_tokens: cacheRead,
    total_cache_creation_tokens: cacheCreation,
    cache_hit_rate: billableInput === 0 ? 0 : cacheRead / billableInput,
    by_stage: byStage,
  };
}
