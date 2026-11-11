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
 * It implements `messages.stream`, because production streams every request. The
 * returned object only needs `finalMessage()`, which is all the client consumes — a
 * fuller fake event stream would be machinery with nothing testing it.
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
      /**
       * Replaces the serialised output with this exact text.
       *
       * For the case where a model returns something that is not JSON at all, which the
       * production code must report rather than crash on.
       */
      readonly rawText?: string;
      /**
       * Tool calls this turn asks for, making the reply a tool-use turn.
       *
       * The loop ends a turn with no tool calls, so a sequence of replies with
       * `toolUses` followed by one without drives a complete exploration. `output` is
       * ignored on a tool-use turn, since the loop reads text and tool calls rather
       * than structured output.
       */
      readonly toolUses?: readonly { name: string; input: unknown }[];
      /** Assistant text accompanying a tool-use turn, which the loop keeps as a summary. */
      readonly text?: string;
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
  /** Tool names offered on this call, so a test can assert on the retrieval arm. */
  readonly toolNames: readonly string[];
}

export interface Stub {
  /** Every request the production code issued, in order. */
  readonly calls: readonly CapturedCall[];
  /** Queues one more reply. */
  readonly reply: (reply: StubReply) => void;
  /** Removes the stub and restores the real client. */
  readonly restore: () => void;
}

interface StreamParams {
  model: string;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.ToolUnion[];
  output_config?: { effort?: string; format?: { schema?: unknown } };
}

/**
 * Installs the stub.
 *
 * Also pins the credentials and the cassette mode, because the production code refuses
 * to attempt a live call without a key and would otherwise take the cassette branch
 * depending on the developer's environment. The stub replaces the transport, not the
 * guards around it.
 */
export function installStub(replies: readonly StubReply[] = []): Stub {
  const queue: StubReply[] = [...replies];
  const calls: CapturedCall[] = [];

  const previousKey = process.env['ANTHROPIC_API_KEY'];
  const previousMode = process.env['SDD_CASSETTE_MODE'];
  const previousProvider = process.env['SDD_PROVIDER'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-stub-for-tests';
  process.env['SDD_CASSETTE_MODE'] = 'off';
  // Pinned so a machine holding an OpenRouter key does not change which gateway the
  // production code thinks it is talking to, and therefore which model slug it sends.
  process.env['SDD_PROVIDER'] = 'anthropic';

  const client = {
    messages: {
      stream: (params: StreamParams) => {
        calls.push({
          model: params.model,
          maxTokens: params.max_tokens,
          system: params.system,
          messages: params.messages,
          effort: params.output_config?.effort,
          schema: params.output_config?.format?.schema,
          // ToolUnion covers server-side toolsets that have no `name`, so this narrows
          // rather than asserting. Our own tools always have one.
          toolNames: (params.tools ?? []).flatMap((tool) =>
            'name' in tool && typeof tool.name === 'string' ? [tool.name] : [],
          ),
        });

        const next = queue.shift();

        return {
          finalMessage: (): Promise<unknown> => {
            if (next === undefined) {
              return Promise.reject(
                new Error(
                  `the stub ran out of queued replies after ${String(calls.length)} call(s); ` +
                    'queue one per expected model call',
                ),
              );
            }

            if ('error' in next) return Promise.reject(next.error);

            // A tool-use turn carries tool_use blocks instead of structured output; the
            // loop reads those and the accompanying text, never `parsed_output`.
            const content =
              next.toolUses === undefined
                ? [
                    // Production reads the JSON out of the text blocks, so the stub must
                    // put it there rather than hand back a pre-parsed object.
                    {
                      type: 'text',
                      // `text` wins when set, so a loop's closing turn can be plain
                      // prose; otherwise the structured output is serialised.
                      text: next.rawText ?? next.text ?? JSON.stringify(next.output),
                      citations: null,
                    },
                  ]
                : [
                    ...(next.text === undefined
                      ? []
                      : [{ type: 'text', text: next.text, citations: null }]),
                    ...next.toolUses.map((use, i) => ({
                      type: 'tool_use',
                      id: `toolu_stub_${String(calls.length)}_${String(i)}`,
                      name: use.name,
                      input: use.input,
                    })),
                  ];

            return Promise.resolve({
              id: `msg_stub_${String(calls.length)}`,
              type: 'message',
              role: 'assistant',
              model: params.model,
              content,
              stop_reason:
                next.stopReason ?? (next.toolUses === undefined ? 'end_turn' : 'tool_use'),
              stop_details: next.stopDetails ?? null,
              usage: {
                input_tokens: next.usage?.input_tokens ?? 12_000,
                output_tokens: next.usage?.output_tokens ?? 2_400,
                cache_read_input_tokens: next.usage?.cache_read_input_tokens ?? 9_000,
                cache_creation_input_tokens: next.usage?.cache_creation_input_tokens ?? 3_000,
              },
            });
          },
        };
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
      // Spelled out per variable: a dynamic delete on process.env is both a lint error
      // and easy to get silently wrong.
      if (previousKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = previousKey;

      if (previousMode === undefined) delete process.env['SDD_CASSETTE_MODE'];
      else process.env['SDD_CASSETTE_MODE'] = previousMode;

      if (previousProvider === undefined) delete process.env['SDD_PROVIDER'];
      else process.env['SDD_PROVIDER'] = previousProvider;
    },
  };
}
