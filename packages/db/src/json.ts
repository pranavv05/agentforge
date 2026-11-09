import { createHash } from 'node:crypto';
import { ValidationError } from '@agentforge/contract';
import type { z } from 'zod';

/**
 * JSON column helpers and content hashing.
 *
 * Two invariants from the quality bar live here:
 *
 * 1. **Nothing read out of a JSON column is trusted.** Every read goes through
 *    `parseJsonColumn`, which validates against the same Zod schema that was used on
 *    the way in. A row hand-edited with `sqlite3`, or written by an older build, fails
 *    loudly at the read rather than propagating a wrong shape into an agent prompt.
 *
 * 2. **Content hashes are canonical.** Approvals bind to a hash, so the hash has to be
 *    a function of the *content* and not of key ordering or whitespace. Re-serialising
 *    the same proposal must always produce the same 64 hex characters.
 */

/**
 * Serialises a value to canonical JSON: object keys sorted, no insignificant
 * whitespace, arrays left in order.
 *
 * This is deliberately not `JSON.stringify` with a replacer — key order from
 * `JSON.stringify` follows insertion order, which differs between a freshly parsed
 * model response and a round-trip through SQLite.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ValidationError(`cannot canonicalize non-finite number: ${String(value)}`);
      }
      // JSON.stringify already emits the shortest round-tripping representation.
      return JSON.stringify(value);
    case 'undefined':
      // Reachable only for an `undefined` passed at the top level; `undefined` inside
      // objects and arrays is handled by the branches below.
      throw new ValidationError('cannot canonicalize undefined');
    case 'object':
      break;
    case 'bigint':
      // Deliberate: silently coercing a bigint would change the value that gets
      // hashed, and an approval binds to that hash.
      throw new ValidationError('cannot canonicalize bigint; convert it explicitly first');
    case 'function':
    case 'symbol':
      throw new ValidationError(`cannot canonicalize value of type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    // `undefined` and functions become null in arrays, matching JSON.stringify.
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // Keys whose value is undefined are omitted, matching JSON.stringify for objects.
    .filter(([, v]) => v !== undefined)
    // Sort by code unit, which is what JSON canonicalisation specifies.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

/** Lowercase SHA-256 hex of a string. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The content hash an approval binds to: SHA-256 over the canonical JSON.
 *
 * Note it covers the structured payload, not the rendered markdown. The markdown is a
 * pure function of the payload, so hashing the payload is both sufficient and immune
 * to a renderer tweak invalidating every historical approval.
 */
export function contentHashOf(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/** Serialises a value for storage in a TEXT column holding JSON. */
export function toJsonColumn(value: unknown): string {
  return canonicalize(value);
}

/**
 * Parses and validates a JSON column.
 *
 * @param schema  the schema the column is expected to satisfy
 * @param raw     the column's string contents
 * @param context human-readable location, used in the error message, e.g.
 *                `artifact_versions.content_json (spec_1, requirements v2)`
 */
export function parseJsonColumn<T>(schema: z.ZodType<T>, raw: string, context: string): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(`${context} is not valid JSON`, {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const result = schema.safeParse(decoded);
  if (!result.success) {
    throw new ValidationError(`${context} failed schema validation`, {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/** SQLite has no boolean type; these keep the 0/1 conversion in one place. */
export const toSqliteBool = (value: boolean): 0 | 1 => (value ? 1 : 0);

export const fromSqliteBool = (value: number): boolean => value !== 0;
