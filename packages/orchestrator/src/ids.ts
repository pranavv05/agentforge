import { randomBytes } from 'node:crypto';

/**
 * Surrogate key generation.
 *
 * Ids are prefixed and time-sortable: prefixed so a value pasted into a bug report
 * says what it is, and time-sortable so `ORDER BY id` is a sensible tiebreaker and an
 * index on it has good locality. Collision risk is 40 random bits inside a single
 * millisecond, which is far beyond anything this system will generate.
 */

export type IdPrefix =
  'spec' | 'art' | 'apr' | 'aud' | 'clr' | 'ev' | 'task' | 'llm' | 'mod' | 'trc';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
}
