import type Anthropic from '@anthropic-ai/sdk';
import { ValidationError } from '@agentforge/contract';

/**
 * Prompt assembly and cache-breakpoint placement.
 *
 * Prompt caching is a *prefix* match: any byte change anywhere in the prefix
 * invalidates everything after it. The whole saving therefore depends on one
 * discipline — stable content first, volatile content last, and nothing in the stable
 * part that varies per request.
 *
 * The order is fixed by `buildSystem`: skill prompt, then compliance pack, then repo
 * map, then module summaries, then approved artifacts. Volatile sections are appended
 * after the cache breakpoint so they cost full price without invalidating the prefix.
 */

export interface PromptSection {
  /** Identifies the section in errors and in the cache-diagnostics log. */
  readonly name: string;
  readonly text: string;
  /**
   * Stable sections form the cacheable prefix and must be byte-identical between
   * requests. A section that changes per request must be marked volatile, or it will
   * silently destroy the cache hit rate for everything after it.
   */
  readonly stable: boolean;
}

/**
 * Patterns that must never appear in a stable section.
 *
 * Each of these is a real way a prefix starts varying per request, and the failure is
 * silent: the request still succeeds, just at ten times the price. Catching it here
 * turns a cost regression into a loud error.
 */
const VOLATILE_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'ISO timestamp', pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ },
  { name: 'UUID', pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  { name: 'correlation id', pattern: /\brun_[0-9a-z]{8,}\b/ },
  { name: 'entity id', pattern: /\b(?:spec|art|apr|aud|clr|ev|task|llm|mod|trc)_[0-9a-z]{10,}\b/ },
];

/**
 * Rejects a stable section that contains per-request content.
 *
 * Exported so the agents' own tests can assert their stable sections are clean without
 * issuing a request.
 */
export function assertStable(section: PromptSection): void {
  for (const { name, pattern } of VOLATILE_PATTERNS) {
    const match = pattern.exec(section.text);
    if (match !== null) {
      throw new ValidationError(
        `prompt section "${section.name}" is marked stable but contains a ${name} ` +
          `("${match[0]}"), which would change the cache prefix on every request`,
        { section: section.name, volatile_kind: name, matched: match[0] },
      );
    }
  }
}

/**
 * Builds the `system` blocks with one cache breakpoint.
 *
 * The breakpoint goes on the last stable block, so the entire stable prefix is cached
 * as a unit. One breakpoint is enough here — the API allows four, but extra
 * breakpoints only help when different requests share different prefix lengths, which
 * is not our shape: every agent call reuses the whole stable prefix or none of it.
 */
export function buildSystem(sections: readonly PromptSection[]): Anthropic.TextBlockParam[] {
  if (sections.length === 0) {
    throw new ValidationError('a prompt must have at least one section');
  }

  const stable = sections.filter((s) => s.stable);
  const volatile = sections.filter((s) => !s.stable);

  for (const section of stable) {
    assertStable(section);
  }

  // A section whose text is empty would add a block for nothing and, worse, could move
  // the breakpoint onto an empty block.
  const nonEmptyStable = stable.filter((s) => s.text.trim().length > 0);
  const nonEmptyVolatile = volatile.filter((s) => s.text.trim().length > 0);

  const blocks: Anthropic.TextBlockParam[] = nonEmptyStable.map((section, index) => {
    const isLastStable = index === nonEmptyStable.length - 1;
    return {
      type: 'text',
      text: section.text,
      // 5-minute TTL (the default): an agent loop reuses the prefix within seconds,
      // and nothing here tries to hold a cache across a human approval gate — a
      // reviewer outlasts any TTL worth paying for, so the context bundle is persisted
      // and the prefix rebuilt instead.
      ...(isLastStable ? { cache_control: { type: 'ephemeral' as const } } : {}),
    };
  });

  for (const section of nonEmptyVolatile) {
    blocks.push({ type: 'text', text: section.text });
  }

  return blocks;
}

/** The concatenated system text, used for cassette keying and token estimation. */
export function systemText(blocks: readonly Anthropic.TextBlockParam[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/**
 * A rough token estimate, used only for the pre-flight budget check.
 *
 * Deliberately an estimate: the point of the check is to stop a loop that has already
 * spent its budget, not to predict the next call to the token. Four characters per
 * token is the usual English approximation; a 30% safety margin is added because the
 * current tokenizer produces roughly 30% more tokens for the same text than older
 * ones, so under-estimating would let a call through that the cap should have stopped.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.3);
}
