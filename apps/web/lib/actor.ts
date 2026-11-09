import { ValidationError } from '@agentforge/contract';
import type { Actor } from '@agentforge/orchestrator';

/**
 * Who is making this request.
 *
 * Authentication is a stub for now: the reviewer identity comes from a header, falling
 * back to a configured default for local development. The *shape* is what matters and
 * is already final — every orchestrator call takes an `Actor` whose `type` the
 * transition table gates on, so adding real auth later changes this file and nothing
 * else.
 *
 * Two rules hold regardless of how identity is resolved:
 *
 * 1. an HTTP request can only ever act as a `human`. Agent actors are constructed
 *    server-side by the agent runners, never accepted from a client, so no API caller
 *    can impersonate an agent to dodge a human-only gate;
 * 2. the resolved identity is written to the audit log verbatim.
 */

const DEV_REVIEWER = 'reviewer@agentforge.local';

/**
 * Resolves the human actor for a request.
 *
 * `type` is hard-coded to `human`: see rule 1 above. This is why an approval arriving
 * over HTTP cannot claim to be an agent, and equally why an agent cannot approve.
 */
export function requestActor(request: Request): Actor {
  const header = request.headers.get('x-agentforge-actor');
  const id = header === null || header.trim().length === 0 ? DEV_REVIEWER : header.trim();

  if (id.length > 200) {
    throw new ValidationError('x-agentforge-actor is too long', { length: id.length });
  }

  return { id, type: 'human' };
}
