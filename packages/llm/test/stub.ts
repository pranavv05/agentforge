import type Anthropic from '@anthropic-ai/sdk';
import { setAnthropicClient } from '../src/index.ts';

/**
 * A stub Anthropic client.
 *
 * Lets the whole agent path — prompt assembly, cache placement, schema validation,
 * grounding checks, artifact write, transition, usage recording — run offline and
 * deterministically. Only the network call is replaced; every other line of production
 * code executes for real, which is the point: a test that stubbed the agent instead
 * would prove nothing about the agent.
 *
 * Each queued reply is returned once, in order, so a test can assert on a multi-call
 * sequence (ask questions, then propose) rather than a single response.
 */

/** A reply either succeeds with output or rejects with an error, never both. */
export type StubReply =
  | {
      /** The structured output this call returns. Must satisfy the request's schema. */
      readonly output: unknown;
      readonly usage?: Partial<{
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number;
        cache_creation_input_tokens: number;
      }>;
      /** Defaults to `end_turn`. Set to exercise refusal and truncation handling. */
      readonly stopReason?: string;
      readonly stopDetails?: { category: string; explanation: string };
    }
  | {
      /**
       * The call rejects with this error, exercising the failure-classification path.
       * Typed as `Error` because the SDK's own error classes extend it, and rejecting
       * with a non-Error would test a case the real transport cannot produce.
       */
      readonly error: Error;
    };

export interface CapturedCall {
  readonly model: string;
  readonly maxTokens: number;
  readonly system: readonly Anthropic.TextBlockParam[];
  readonly messages: readonly Anthropic.MessageParam[];
  readonly effort: string | undefined;
  /** The JSON schema the request asked the model to satisfy. */
  readonly schema: unknown;
}

export interface Stub {
  /** Every request the production code issued, in order. */
  readonly calls: readonly CapturedCall[];
  /** Queues one more reply. */
  readonly reply: (reply: StubReply) => void;
  /** Removes the stub and restores the real client. */
  readonly restore: () => void;
}

interface ParseParams {
  model: string;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  output_config?: { effort?: string; format?: { schema?: unknown } };
}

/**
 * Installs the stub.
 *
 * Also sets a placeholder `ANTHROPIC_API_KEY`, because the production code refuses to
 * attempt a live call without one — the stub replaces the transport, not the guard.
 */
export function installStub(replies: readonly StubReply[] = []): Stub {
  const queue: StubReply[] = [...replies];
  const calls: CapturedCall[] = [];

  const previousKey = process.env['ANTHROPIC_API_KEY'];
  const previousMode = process.env['SDD_CASSETTE_MODE'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-stub-for-tests';
  process.env['SDD_CASSETTE_MODE'] = 'off';

  const client = {
    messages: {
      parse: (params: ParseParams) => {
        calls.push({
          model: params.model,
          maxTokens: params.max_tokens,
          system: params.system,
          messages: params.messages,
          effort: params.output_config?.effort,
          schema: params.output_config?.format?.schema,
        });

        const next = queue.shift();
        if (next === undefined) {
          return Promise.reject(
            new Error(
              `the stub ran out of queued replies after ${String(calls.length)} call(s); ` +
                'queue one per expected model call',
            ),
          );
        }

        if ('error' in next) {
          return Promise.reject(next.error);
        }

        return Promise.resolve({
          id: `msg_stub_${String(calls.length)}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [],
          parsed_output: next.output,
          stop_reason: next.stopReason ?? 'end_turn',
          stop_details: next.stopDetails ?? null,
          usage: {
            input_tokens: next.usage?.input_tokens ?? 12_000,
            output_tokens: next.usage?.output_tokens ?? 2_400,
            cache_read_input_tokens: next.usage?.cache_read_input_tokens ?? 9_000,
            cache_creation_input_tokens: next.usage?.cache_creation_input_tokens ?? 3_000,
          },
        });
      },
    },
  };

  // The stub implements only the surface `complete()` uses; casting through `unknown`
  // keeps that explicit rather than pretending to be a whole SDK client.
  setAnthropicClient(client as unknown as Anthropic);

  return {
    calls,
    reply: (reply: StubReply) => {
      queue.push(reply);
    },
    restore: () => {
      setAnthropicClient(null);
      if (previousKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = previousKey;
      if (previousMode === undefined) delete process.env['SDD_CASSETTE_MODE'];
      else process.env['SDD_CASSETTE_MODE'] = previousMode;
    },
  };
}
