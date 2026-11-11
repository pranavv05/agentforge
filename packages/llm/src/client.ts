import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  type LlmStage,
  UpstreamError,
  ValidationError,
  isAgentForgeError,
} from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  assertWithinBudget,
  computeCost,
  recordLlmCall,
  runLogger,
  type TokenUsage,
} from '@agentforge/orchestrator';
import type { z } from 'zod';
import { cassetteKey, readCassette, writeCassette, type Cassette } from './cassette.ts';
import {
  cassetteMode,
  effortForStage,
  maxPromptTokens,
  maxTokensForStage,
  modelForStage,
} from './config.ts';
import { buildSystem, estimateTokens, systemText, type PromptSection } from './prompt.ts';
import { hasCredentials, resolveProvider, toProviderModel } from './provider.ts';

/**
 * The Claude client wrapper.
 *
 * Every model call in the system goes through `complete`, which is the only place that
 * knows how to talk to the API. Centralising it buys five properties that would
 * otherwise have to be re-established at each call site:
 *
 * 1. **Structured output.** The caller supplies a Zod schema; the response is
 *    schema-valid JSON or the call fails. Nothing parses model prose.
 * 2. **Budget enforcement.** The per-run ceiling is checked *before* the request is
 *    issued, so no code path can skip it.
 * 3. **Prompt caching.** The stable prefix is assembled and the breakpoint placed by
 *    `prompt.ts`, with a guard that rejects per-request content in a stable section.
 * 4. **Measured spend.** Token and cache counters land in `llm_calls` on every call,
 *    including replays, which is what makes the cost claims defensible.
 * 5. **Cassettes.** Offline, deterministic replay for tests.
 *
 * A note on why this uses structured outputs rather than forced tool use: on the
 * current models `tool_choice: {type: "any"}` and `{type: "tool"}` are rejected, and
 * the forced call only ever existed to get JSON back. `output_config.format` is the
 * supported way to do that, and it keeps one code path across models.
 */

let singleton: Anthropic | null = null;

/**
 * The shared SDK client, built for whichever gateway is configured.
 *
 * Constructed lazily so importing this module needs no key. OpenRouter speaks the
 * Anthropic Messages format, so only the base URL and the auth header differ — the
 * request shapes, structured outputs and cache breakpoints are identical.
 */
export function anthropic(): Anthropic {
  if (singleton === null) {
    const provider = resolveProvider();
    singleton = new Anthropic({
      ...(provider.baseURL === undefined ? {} : { baseURL: provider.baseURL }),
      ...(provider.authToken === null ? {} : { authToken: provider.authToken }),
      apiKey: provider.apiKey,
      // Two retries, with the SDK handling 408/409/429/5xx.
      maxRetries: 2,
    });
  }
  return singleton;
}

/** Replaces the client. Tests use this to inject a stub. */
export function setAnthropicClient(client: Anthropic | null): void {
  singleton = client;
}

export interface CompleteRequest<T> {
  readonly db: Db;
  readonly specId: string | null;
  readonly stage: LlmStage;
  readonly correlationId: string;
  /** Prompt sections, in prefix order. Stable ones form the cached prefix. */
  readonly sections: readonly PromptSection[];
  /** The request itself: what the model is being asked to produce now. */
  readonly userMessage: string;
  /** The shape the response must satisfy. Enforced by the API and re-checked locally. */
  readonly schema: z.ZodType<T>;
  /** Name used in the JSON-schema and in cassette labels. */
  readonly schemaName: string;
  /** Overrides the stage default. */
  readonly maxTokens?: number;
  /** Prior turns, for the clarification round-trip. */
  readonly history?: readonly Anthropic.MessageParam[];
}

export interface CompleteResult<T> {
  readonly output: T;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly model: string;
  readonly fromCassette: boolean;
  readonly latencyMs: number;
}

/**
 * The gateway's own cost figure, when it supplies one.
 *
 * Not part of the Anthropic usage type, so it is read defensively rather than cast:
 * OpenRouter adds `cost` (in USD) to the usage object, and a gateway that does not is
 * simply absent here.
 */
function readReportedCost(usage: Anthropic.Usage): number | null {
  const value = (usage as unknown as { cost?: unknown }).cost;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Normalises the SDK's usage object, which leaves cache fields unset when unused. */
function readUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Maps an SDK failure onto the error taxonomy.
 *
 * Classified most-specific-first. A 4xx that is not rate limiting is our bug or our
 * input and must not be retried; everything else is upstream and transient.
 */
function toTaxonomy(error: unknown, model: string, stage: LlmStage): never {
  if (isAgentForgeError(error)) throw error;

  if (error instanceof Anthropic.AuthenticationError) {
    throw new UpstreamError('the Anthropic API rejected the credentials; check ANTHROPIC_API_KEY', {
      details: { model, stage, status: error.status },
      cause: error,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    throw new UpstreamError(`the Anthropic API rejected the request: ${error.message}`, {
      details: { model, stage, status: error.status },
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    throw new UpstreamError('the Anthropic API rate limit was exceeded', {
      details: { model, stage, status: error.status },
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    // `status` is loosely typed on the base class, so narrow rather than pass it through.
    const status = typeof error.status === 'number' ? error.status : null;
    // The gateway's own explanation is the useful part of a 4xx, but `error` is loosely
    // typed on the base class, so it is serialised rather than passed through as-is.
    const body: unknown = error.error;
    throw new UpstreamError(`the model gateway failed: ${error.message}`, {
      details: { model, stage, status, body: body === undefined ? null : body },
      cause: error,
    });
  }

  // The catch-all still has to say what happened. Discarding the cause here cost a
  // debugging cycle on the first live run: "the API call failed" names no failure.
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  throw new UpstreamError(`the model call failed — ${detail}`, {
    details: { model, stage },
    cause: error,
  });
}

/**
 * Issues one structured-output request.
 *
 * Returns schema-valid data or throws. There is no partial-success path: a response
 * that does not validate is a failure, logged with the issues, never a degraded
 * result that flows onward into a document a human will approve.
 */
export async function complete<T>(request: CompleteRequest<T>): Promise<CompleteResult<T>> {
  const model = modelForStage(request.stage);
  const effort = effortForStage(request.stage);
  const maxTokens = request.maxTokens ?? maxTokensForStage(request.stage);
  const log = runLogger(request.correlationId, {
    ...(request.specId === null ? {} : { spec_id: request.specId }),
    stage: request.stage,
    model,
  });

  const system = buildSystem(request.sections);
  const messages: Anthropic.MessageParam[] = [
    ...(request.history ?? []),
    { role: 'user', content: request.userMessage },
  ];

  // The SDK's `zodOutputFormat` returns { type, schema, parse }, and the SDK calls that
  // `parse` itself — throwing its own AnthropicError before our code sees the response.
  // That is the wrong shape of failure here: a bound violation would surface as an
  // opaque upstream error instead of a ValidationError naming the offending field, and
  // our local re-validation below would never run at all.
  //
  // So we keep the generated JSON schema and drop the parser. This is also what makes
  // the local check meaningful rather than redundant: the JSON-schema conversion moves
  // string lengths and array bounds into *descriptions*, which the API does not
  // enforce, so the model can and does exceed them.
  const generated = zodOutputFormat(request.schema);
  const format = { type: generated.type, schema: generated.schema };

  // Pre-flight prompt-size check. Above 100K tokens Haiku prices five times higher, so
  // exceeding the ceiling is a cost cliff, not a soft limit.
  const promptChars = systemText(system) + request.userMessage;
  const estimated = estimateTokens(promptChars);
  const ceiling = maxPromptTokens();
  if (estimated > ceiling) {
    throw new ValidationError(
      `the assembled prompt is roughly ${String(estimated)} tokens, above the ` +
        `${String(ceiling)} ceiling; trim the context before calling`,
      { stage: request.stage, estimated_tokens: estimated, ceiling },
    );
  }

  const provider = resolveProvider();
  const providerModel = toProviderModel(model, provider.name);

  const key = cassetteKey({
    model,
    effort,
    system: systemText(system),
    messages,
    schema: format.schema,
  });

  const mode = cassetteMode();

  if (mode === 'replay') {
    const cassette = readCassette(key);
    if (cassette === undefined) {
      throw new ValidationError(
        `no cassette recorded for this request (key ${key}, stage ${request.stage}). ` +
          'Run with SDD_CASSETTE_MODE=record and a live API key to capture it, or fix ' +
          'the prompt if it changed unintentionally.',
        { cassette_key: key, stage: request.stage, model },
      );
    }
    return finishFromCassette(request, cassette, key, model, log);
  }

  if (!hasCredentials()) {
    throw new UpstreamError(
      'no ANTHROPIC_API_KEY or OPENROUTER_API_KEY is set, so a live model call cannot ' +
        'be made. Set SDD_CASSETTE_MODE=replay to run against recorded responses.',
      { details: { stage: request.stage, model } },
    );
  }

  // Estimate the cost of this call and refuse it if the run has already spent its
  // budget. Checked before the request, so the ceiling is a real ceiling.
  if (request.specId !== null) {
    const projected = computeCost(model, {
      inputTokens: estimated,
      outputTokens: maxTokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    assertWithinBudget(request.db, request.specId, projected, request.correlationId);
  }

  const startedAt = Date.now();

  // Always streamed, for two reasons found on the first live run. The SDK refuses a
  // non-streaming request whose `max_tokens` could exceed its ten-minute ceiling, and
  // the design stage legitimately needs a large budget: the compliance pack injects
  // criteria, so one feature produced 13 requirements and 21 acceptance criteria for the
  // design to cover, and thinking tokens are charged against the same budget.
  //
  // Streaming also keeps this to one code path. Nothing is lost by not using
  // `messages.parse`: its `parsed_output` is a convenience, and the response is
  // re-validated against the Zod schema below either way, because the JSON-schema
  // conversion drops the bounds.
  const response = await (async () => {
    try {
      const stream = anthropic().messages.stream({
        model: providerModel,
        max_tokens: maxTokens,
        system,
        messages,
        // `effort` and `format` share output_config. Thinking is deliberately left
        // unset: it is adaptive by default on the models we use, and both an explicit
        // `disabled` and a `budget_tokens` value are rejected by them.
        output_config: { effort, format },
      });
      return await stream.finalMessage();
    } catch (error) {
      toTaxonomy(error, model, request.stage);
    }
  })();

  const latencyMs = Date.now() - startedAt;

  if (response.stop_reason === 'refusal') {
    throw new UpstreamError(
      `the model declined this request (${response.stop_details?.category ?? 'no category'})`,
      {
        details: {
          stage: request.stage,
          model,
          category: response.stop_details?.category ?? null,
          explanation: response.stop_details?.explanation ?? null,
        },
      },
    );
  }

  if (response.stop_reason === 'max_tokens') {
    throw new UpstreamError(
      `the model hit the ${String(maxTokens)}-token output ceiling before finishing, so ` +
        'the structured output is incomplete. Raise the ceiling for this stage, or set ' +
        'SDD_MAX_OUTPUT_TOKENS. Note that thinking tokens count towards this budget.',
      { details: { stage: request.stage, model, max_tokens: maxTokens } },
    );
  }

  const usage = readUsage(response.usage);

  // A structured-output response carries its JSON in the text blocks.
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (text.trim().length === 0) {
    log.error({ stop_reason: response.stop_reason }, 'model returned no text content');
    throw new UpstreamError('the model returned no output', {
      details: { stage: request.stage, model, stop_reason: response.stop_reason },
    });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (cause) {
    log.error({ stop_reason: response.stop_reason }, 'structured output was not valid JSON');
    throw new UpstreamError(
      'the model returned output that was not valid JSON despite a schema being requested',
      { details: { stage: request.stage, model, stop_reason: response.stop_reason }, cause },
    );
  }

  // Re-validate locally. The gateway guarantees the *shape*; our schema also carries the
  // bounds (string lengths, array sizes, id formats) that the JSON-schema conversion
  // moves into descriptions, so this is the check that actually enforces them.
  const validated = request.schema.safeParse(decoded);
  if (!validated.success) {
    log.error({ issues: validated.error.issues }, 'structured output failed local validation');
    throw new ValidationError(
      'the model output matched the JSON schema but violated the contract constraints',
      { stage: request.stage, model, issues: validated.error.issues },
    );
  }

  // OpenRouter returns the exact charge for the request; the first-party API does not,
  // so there the computed estimate stands. Recording which is which keeps the report's
  // cost claims honest.
  const reportedCostUsd = readReportedCost(response.usage);

  const costUsd = recordLlmCall(request.db, {
    specId: request.specId,
    stage: request.stage,
    model,
    usage,
    latencyMs,
    fromCassette: false,
    correlationId: request.correlationId,
    reportedCostUsd,
  });

  log.info(
    {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read: usage.cacheReadInputTokens,
      cache_creation: usage.cacheCreationInputTokens,
      cost_usd: costUsd,
      cost_source: reportedCostUsd === null ? 'computed' : 'reported',
      provider: provider.name,
      latency_ms: latencyMs,
    },
    'model call completed',
  );

  if (mode === 'record') {
    const path = writeCassette(key, {
      label: `${request.stage}:${request.schemaName}`,
      model,
      output: validated.data,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_input_tokens: usage.cacheReadInputTokens,
        cache_creation_input_tokens: usage.cacheCreationInputTokens,
      },
      stop_reason: response.stop_reason,
      source: 'recorded',
      recorded_at: new Date().toISOString(),
    });
    log.info({ cassette_key: key, path }, 'recorded cassette');
  }

  return { output: validated.data, usage, costUsd, model, fromCassette: false, latencyMs };
}

/** Completes a request from a recorded response, still recording the (zero) spend. */
function finishFromCassette<T>(
  request: CompleteRequest<T>,
  cassette: Cassette,
  key: string,
  model: string,
  log: ReturnType<typeof runLogger>,
): CompleteResult<T> {
  // A cassette is a fixture on disk, so it is validated like any other untrusted input
  // before it can reach an artifact.
  const validated = request.schema.safeParse(cassette.output);
  if (!validated.success) {
    throw new ValidationError(
      `cassette ${key} holds output that no longer matches the schema; re-record it`,
      { cassette_key: key, stage: request.stage, issues: validated.error.issues },
    );
  }

  const usage: TokenUsage = {
    inputTokens: cassette.usage.input_tokens,
    outputTokens: cassette.usage.output_tokens,
    cacheReadInputTokens: cassette.usage.cache_read_input_tokens,
    cacheCreationInputTokens: cassette.usage.cache_creation_input_tokens,
  };

  // Recorded with fromCassette so the cost is zero but the call still appears in
  // llm_calls: a replayed run and a live run have the same shape in the audit trail.
  const costUsd = recordLlmCall(request.db, {
    specId: request.specId,
    stage: request.stage,
    model,
    usage,
    latencyMs: 0,
    fromCassette: true,
    correlationId: request.correlationId,
  });

  log.debug({ cassette_key: key }, 'replayed cassette');

  return { output: validated.data, usage, costUsd, model, fromCassette: true, latencyMs: 0 };
}
