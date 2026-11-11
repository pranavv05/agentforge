import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NotFoundError, ValidationError } from '@agentforge/contract';

/**
 * Which spec this implementation session is working on.
 *
 * Both the MCP server and the PreToolUse hook need the answer, and they must agree, so
 * resolution lives in one place. Two sources, in order:
 *
 * 1. `SDD_SPEC_ID` in the environment — what the plugin sets for a scoped session;
 * 2. `.sdd/current-spec` in the working tree — what `/sdd-implement` writes, so the
 *    context survives a restart and is visible to anyone looking at the checkout.
 *
 * When neither is present there is no spec context, and that is reported as `null`
 * rather than as an error. This matters for the hook: a session that is not
 * implementing a spec must not have its edits governed by one.
 */

/** The file `/sdd-implement` writes to pin the session to a spec. */
export const CURRENT_SPEC_FILE = join('.sdd', 'current-spec');

const SPEC_ID_PATTERN = /^spec_[0-9a-z]{8,}$/;

/** Reads the spec id for this session, or null when the session is not scoped to one. */
export function resolveSpecId(cwd: string = process.cwd()): string | null {
  const fromEnv = process.env['SDD_SPEC_ID']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return assertSpecIdShape(fromEnv, 'SDD_SPEC_ID');
  }

  const file = resolve(cwd, CURRENT_SPEC_FILE);
  if (!existsSync(file)) return null;

  const contents = readFileSync(file, 'utf8').trim();
  if (contents.length === 0) return null;

  // Only the first line matters, so a trailing note in the file is harmless.
  const firstLine = contents.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;

  return assertSpecIdShape(firstLine, CURRENT_SPEC_FILE);
}

/**
 * Rejects anything that is not a spec id.
 *
 * The value reaches a SQL query, and it arrives from the environment or a file in the
 * working tree, so it is untrusted input. Drizzle parameterises the query, but a shape
 * check turns a typo into a clear message instead of a silent "no such spec".
 */
function assertSpecIdShape(value: string, source: string): string {
  if (!SPEC_ID_PATTERN.test(value)) {
    throw new ValidationError(
      `${source} does not look like a spec id (expected spec_..., received "${value}")`,
      { source, value },
    );
  }
  return value;
}

/** The spec id, or a clear error naming both ways to set it. */
export function requireSpecId(cwd: string = process.cwd()): string {
  const specId = resolveSpecId(cwd);
  if (specId === null) {
    throw new NotFoundError(
      'this session is not scoped to a spec. Set SDD_SPEC_ID, or run /sdd-implement to ' +
        `write ${CURRENT_SPEC_FILE} in the repository.`,
      { cwd },
    );
  }
  return specId;
}
