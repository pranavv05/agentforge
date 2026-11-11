import Anthropic from '@anthropic-ai/sdk';
import { type LlmStage, UpstreamError, ValidationError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import {
  assertWithinBudget,
  computeCost,
  recordLlmCall,
  runLogger,
} from '@agentforge/orchestrator';
import { anthropic } from './client.ts';
import { effortForStage, maxPromptTokens, maxTokensForStage, modelForStage } from './config.ts';
import { buildSystem, estimateTokens, systemText, type PromptSection } from './prompt.ts';
import { resolveProvider, toProviderModel } from './provider.ts';

/**
 * The tool-use loop.
 *
 * Separate from `complete()` because the two cannot be combined: **structured outputs
 * and tool use are mutually exclusive**. A request carrying both `tools` and
 * `output_config.format` is rejected, so an agent that must search a repository *and*
 * return a schema-valid proposal has to do it in two phases:
 *
 * 1. this loop, which lets the model search with tools and returns the transcript;
 * 2. a `complete()` call, which turns that transcript into validated JSON.
 *
 * Splitting it has a second benefit: the expensive, unpredictable phase is budget-capped
 * and observable, while the phase that produces the artifact is schema-guaranteed.
 *
 * Everything the loop spends is recorded per iteration, so a run that hits its ceiling
 * is visible in `llm_calls` rather than merely failing.
 */

export interface LoopTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's input. */
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolInvocation {
  readonly name: string;
  readonly input: unknown;
  /** 1-based index across the whole loop, for the budget display. */
  readonly index: number;
}

export interface ToolLoopRequest {
  readonly db: Db;
  readonly specId: string | null;
  readonly stage: LlmStage;
  readonly correlationId: string;
  readonly sections: readonly PromptSection[];
  readonly userMessage: string;
  readonly tools: readonly LoopTool[];
  /**
   * Runs one tool call and returns its result as text.
   *
   * Must not throw for a bad argument: a tool error is information the model should see
   * and correct, so it is returned as an error result rather than aborting the loop.
   */
  readonly execute: (invocation: ToolInvocation) => Promise<string> | string;
  /** Hard ceiling on tool calls. The loop stops when it is reached. */
  readonly maxToolCalls: number;
  /** Called as the loop progresses, for the SSE budget bar. */
  readonly onToolCall?: (invocation: ToolInvocation) => void;
}

export interface ToolLoopResult {
  /** The model's closing text, which is its own account of what it found. */
  readonly summary: string;
  /** Every tool call made, with its result, in order. */
  readonly transcript: readonly {
    readonly name: string;
    readonly input: unknown;
    readonly result: string;
  }[];
  readonly toolCallsUsed: number;
  /** True when the loop stopped because the budget ran out, not because it finished. */
  readonly budgetExhausted: boolean;
  readonly costUsd: number;
  readonly model: string;
}

/** Caps a tool result so one `read` of a large file cannot consume the prompt budget. */
const MAX_TOOL_RESULT_CHARS = 20_000;

export async function runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
  if (request.tools.length === 0) {
    throw new ValidationError('a tool loop needs at least one tool');
  }
  if (request.maxToolCalls < 1) {
    throw new ValidationError('maxToolCalls must be at least 1', {
      max_tool_calls: request.maxToolCalls,
    });
  }

  const model = modelForStage(request.stage);
  const effort = effortForStage(request.stage);
  const maxTokens = maxTokensForStage(request.stage);
  const provider = resolveProvider();
  const providerModel = toProviderModel(model, provider.name);

  const log = runLogger(request.correlationId, {
    ...(request.specId === null ? {} : { spec_id: request.specId }),
    stage: request.stage,
    model,
  });

  const system = buildSystem(request.sections);
  const tools: Anthropic.ToolUnion[] = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }));

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.userMessage }];

  const transcript: { name: string; input: unknown; result: string }[] = [];
  let toolCallsUsed = 0;
  let costUsd = 0;
  let budgetExhausted = false;
  let summary = '';

  // One iteration per model turn. The ceiling on *tool calls* bounds the loop, and the
  // extra headroom here only covers turns that make no tool call at all.
  const maxTurns = request.maxToolCalls + 5;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    // The prompt grows with every tool result, so the ceiling is re-checked each turn
    // rather than once: this is the loop that would otherwise drift over the price band.
    const promptChars = systemText(system) + JSON.stringify(messages);
    const estimated = estimateTokens(promptChars);
    const ceiling = maxPromptTokens();

    if (estimated > ceiling) {
      log.warn(
        { estimated_tokens: estimated, ceiling, tool_calls: toolCallsUsed },
        'tool loop stopped: prompt ceiling reached',
      );
      budgetExhausted = true;
      break;
    }

    if (request.specId !== null) {
      assertWithinBudget(
        request.db,
        request.specId,
        computeCost(model, {
          inputTokens: estimated,
          outputTokens: maxTokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        }),
        request.correlationId,
      );
    }

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await anthropic()
        .messages.stream({
          model: providerModel,
          max_tokens: maxTokens,
          system,
          messages,
          tools,
          // No `output_config.format` here: it cannot be combined with tools. The
          // schema-constrained proposal is a separate call once the loop is done.
          output_config: { effort },
        })
        .finalMessage();
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        // `status` is loosely typed on the base class, so narrow rather than pass through.
        const status = typeof error.status === 'number' ? error.status : null;
        throw new UpstreamError(`the model gateway failed during exploration: ${error.message}`, {
          details: { stage: request.stage, model, status },
          cause: error,
        });
      }
      throw new UpstreamError(
        `exploration failed — ${error instanceof Error ? error.message : String(error)}`,
        { details: { stage: request.stage, model }, cause: error },
      );
    }

    costUsd += recordLlmCall(request.db, {
      specId: request.specId,
      stage: request.stage,
      model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      latencyMs: Date.now() - startedAt,
      fromCassette: false,
      correlationId: request.correlationId,
    });

    // Keep whatever text the model produced: the final turn's text is its own summary
    // of what it found, which the proposal call is given.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text.length > 0) summary = text;

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      // The model stopped asking for tools, which is how it signals it is done.
      log.info({ tool_calls: toolCallsUsed, turns: turn + 1 }, 'tool loop finished');
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    let hitCeiling = false;

    for (const toolUse of toolUses) {
      if (toolCallsUsed >= request.maxToolCalls) {
        hitCeiling = true;
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          // Told plainly, so the model's next turn writes up what it has rather than
          // trying another search and failing again.
          content:
            `The exploration budget of ${String(request.maxToolCalls)} tool calls is spent. ` +
            'Make no further tool calls: summarise what you have found now.',
          is_error: true,
        });
        continue;
      }

      toolCallsUsed += 1;
      const invocation: ToolInvocation = {
        name: toolUse.name,
        input: toolUse.input,
        index: toolCallsUsed,
      };
      request.onToolCall?.(invocation);

      let result: string;
      let isError = false;
      try {
        result = await request.execute(invocation);
      } catch (error) {
        // A tool failure is information, not a crash: the model should see it and
        // correct course. Aborting the loop would throw away everything found so far.
        result = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        isError = true;
      }

      const truncated =
        result.length > MAX_TOOL_RESULT_CHARS
          ? `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[truncated; narrow the range or the pattern]`
          : result;

      transcript.push({ name: toolUse.name, input: toolUse.input, result: truncated });
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: truncated,
        ...(isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: 'user', content: results });

    if (hitCeiling) {
      budgetExhausted = true;
      log.warn({ tool_calls: toolCallsUsed }, 'tool loop stopped: tool-call budget spent');
      // One more turn so the model can write its summary, then stop.
      const closing = await anthropic()
        .messages.stream({
          model: providerModel,
          max_tokens: maxTokens,
          system,
          messages,
          output_config: { effort },
        })
        .finalMessage();

      costUsd += recordLlmCall(request.db, {
        specId: request.specId,
        stage: request.stage,
        model,
        usage: {
          inputTokens: closing.usage.input_tokens,
          outputTokens: closing.usage.output_tokens,
          cacheReadInputTokens: closing.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: closing.usage.cache_creation_input_tokens ?? 0,
        },
        latencyMs: 0,
        fromCassette: false,
        correlationId: request.correlationId,
      });

      const closingText = closing.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (closingText.length > 0) summary = closingText;
      break;
    }
  }

  return { summary, transcript, toolCallsUsed, budgetExhausted, costUsd, model };
}
