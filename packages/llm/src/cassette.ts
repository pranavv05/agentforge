import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '@agentforge/contract';
import { z } from 'zod';

/**
 * Recorded model responses.
 *
 * The agent suite has to be deterministic and free to run, or it stops being run. A
 * cassette stores the response for an exact request shape, keyed by a hash of
 * everything that affects the output, so:
 *
 * - CI runs `replay` and never touches the network or an API key;
 * - a developer runs `record` once with a key to capture new fixtures;
 * - `off` goes straight to the live API.
 *
 * The key deliberately covers the model, the system prompt, the messages and the
 * output schema. If any of those change, the cassette misses — which is correct: a
 * prompt edit must not silently keep passing against a stale recording.
 */

const DEFAULT_CASSETTE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cassettes');

/**
 * Where cassettes live.
 *
 * Overridable so tests write to a temp directory instead of the committed fixture
 * folder, and so the eval harness can keep its own recordings separate.
 */
export function cassetteDir(): string {
  return process.env['SDD_CASSETTE_DIR'] ?? DEFAULT_CASSETTE_DIR;
}

/** The subset of a response worth recording. */
export const CassetteSchema = z.strictObject({
  /** Human-readable note so a fixture file is identifiable without decoding the key. */
  label: z.string(),
  model: z.string(),
  /** The validated structured output the model returned. */
  output: z.unknown(),
  usage: z.strictObject({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative(),
  }),
  stop_reason: z.string().nullable(),
  /**
   * Provenance. `recorded` came back from the live API; `authored` was written by
   * hand as a fixture. Explicit so an authored fixture can never be mistaken for
   * evidence of real model behaviour — the two are not interchangeable when judging
   * whether the agents actually work.
   */
  source: z.enum(['recorded', 'authored']),
  /** ISO timestamp of the recording, for provenance only; not part of the key. */
  recorded_at: z.string(),
});

export type Cassette = z.infer<typeof CassetteSchema>;

export interface CassetteKeyParts {
  readonly model: string;
  readonly system: string;
  readonly messages: unknown;
  readonly schema: unknown;
  readonly effort: string;
}

/**
 * The cassette key.
 *
 * Canonical JSON of every input that changes the output. `JSON.stringify` with sorted
 * keys would be enough here because the inputs we build are already deterministic, but
 * sorting is applied anyway so a reordered object cannot produce a second key for the
 * same logical request.
 */
export function cassetteKey(parts: CassetteKeyParts): string {
  const canonical = JSON.stringify({
    model: parts.model,
    effort: parts.effort,
    system: parts.system,
    messages: parts.messages,
    schema: parts.schema,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

function cassettePath(key: string): string {
  return join(cassetteDir(), `${key}.json`);
}

/** Reads a cassette, or `undefined` when none is recorded for this key. */
export function readCassette(key: string): Cassette | undefined {
  const path = cassettePath(key);
  if (!existsSync(path)) return undefined;

  const raw = readFileSync(path, 'utf8');
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(`cassette ${key} is not valid JSON`, {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const result = CassetteSchema.safeParse(decoded);
  if (!result.success) {
    throw new ValidationError(`cassette ${key} does not match the cassette schema`, {
      path,
      issues: result.error.issues,
    });
  }
  return result.data;
}

/** Writes a cassette. Overwrites an existing recording for the same key. */
export function writeCassette(key: string, cassette: Cassette): string {
  mkdirSync(cassetteDir(), { recursive: true });
  const path = cassettePath(key);
  writeFileSync(path, `${JSON.stringify(cassette, null, 2)}\n`, 'utf8');
  return path;
}

// `listCassettes` lives in `cassette-list.ts`, not here. It scans a directory, and this
// module is reachable from a Next API route through the client — which makes the bundler
// trace the entire project into the server bundle. Keeping a test-only directory scan
// out of that import graph is cheaper than declaring the access safe.

export { DEFAULT_CASSETTE_DIR };
