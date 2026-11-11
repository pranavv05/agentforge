import { UnauthenticatedError, ValidationError } from '@agentforge/contract';
import type { Actor } from '@agentforge/orchestrator';
import { getAuth } from './auth';

/**
 * Who is making this request.
 *
 * The identity comes from a signed session cookie and nowhere else. This is the point
 * where the governance claim stops being structural and becomes evidential: the audit
 * log records the actor verbatim, so what it proves is exactly as strong as what this
 * function resolves. While identity was a request header, the log could only show that
 * *something claiming to be* a reviewer approved a hash. Now it names the account.
 *
 * Two rules hold regardless of how identity is resolved:
 *
 * 1. an HTTP request can only ever act as a `human`. Agent actors are constructed
 *    server-side by the agent runners, never accepted from a client, so no API caller
 *    can impersonate an agent to dodge a human-only gate — and equally, no agent can
 *    reach an approval edge;
 * 2. the resolved identity is written to the audit log verbatim.
 *
 * **Why the actor id is the email and not the user id.** An audit entry is read by
 * people, and `reviewer@acme.com` tells a reviewer something that a random identifier
 * does not. Emails are `UNIQUE` in the schema, and the log is a record of who someone
 * *was at the time*, so a later email change correctly leaves old entries untouched —
 * the same reasoning as `audit_log.actor` being text rather than a foreign key. The
 * trade-off, stated plainly: if an address were ever reassigned between two people, the
 * log could not distinguish them. For that to matter an administrator would have to
 * delete an account and re-register its address to someone else, and the user table
 * records enough to reconstruct it.
 */

/** The maximum length the audit log will accept for an actor id. */
const MAX_ACTOR_ID = 200;

/**
 * Resolves the human actor for a request, or refuses it.
 *
 * Throws `UNAUTHENTICATED` rather than returning a fallback identity. A default actor
 * here would mean an unauthenticated caller could record an approval under a borrowed
 * name, which is the one failure this layer exists to prevent.
 */
export async function requestActor(request: Request): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers: request.headers });

  if (session === null) {
    throw new UnauthenticatedError();
  }

  const id = session.user.email.trim();

  if (id.length === 0) {
    // Better Auth requires an email, so this is defensive rather than reachable. It
    // throws instead of falling back because an unnamed approval is worse than a
    // refused one.
    throw new ValidationError('the signed-in user has no email to record as the actor', {
      user_id: session.user.id,
    });
  }

  if (id.length > MAX_ACTOR_ID) {
    throw new ValidationError('the signed-in user’s email is too long to record', {
      length: id.length,
    });
  }

  // `type` is hard-coded to `human`: see rule 1 above. This is why an approval arriving
  // over HTTP cannot claim to be an agent, and equally why an agent cannot approve.
  return { id, type: 'human' };
}

/**
 * The signed-in user, for presentation.
 *
 * Returns `null` instead of throwing, because a page deciding whether to show a sign-in
 * link is not the same question as a route deciding whether to allow a write.
 */
export async function currentUser(request: Request): Promise<{
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
} | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (session === null) return null;

  const role = (session.user as { role?: unknown }).role;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: typeof role === 'string' && role.length > 0 ? role : 'reviewer',
  };
}
