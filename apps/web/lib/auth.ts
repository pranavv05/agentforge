import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from '@agentforge/db';

/**
 * Authentication.
 *
 * This is not decoration on top of the governance model — it is what makes the central
 * claim true. The audit log is meant to prove that *a named human* approved a specific
 * content hash. With a stubbed identity it could only prove that something claiming to
 * be human did, which is a much weaker statement for a system whose whole argument is
 * that gates are enforced rather than trusted.
 *
 * Email and password only. No OAuth provider: a third-party identity provider would add
 * client secrets to manage and an external dependency to a demo, and buys nothing here —
 * the question is *which human*, not *how they prefer to sign in*.
 *
 * It shares the application's SQLite connection rather than opening its own. One file,
 * one connection, so a user row and the audit row naming it commit to the same database
 * and a backup can never capture one without the other.
 *
 * **Why this is built lazily.** `next build` evaluates every route module to collect
 * its configuration, with `NODE_ENV=production` and none of the runtime environment
 * present. Constructing the instance at module scope therefore ran the secret check
 * during the build — which failed the build — and opened a SQLite connection while
 * compiling, which it has no business doing. Both are side effects that belong to
 * serving a request, so they happen on the first request instead.
 */

/**
 * The session secret.
 *
 * Deliberately fails loudly rather than defaulting. A signing key with a fallback value
 * is the kind of thing that ships to production unnoticed, and here it would mean
 * forgeable sessions — which in this system means forgeable approvals.
 */
function authSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET']?.trim();

  if (secret === undefined || secret.length === 0) {
    // Tests and local development get a fixed, obviously-not-secret value, and only
    // outside production. `next build` sets NODE_ENV=production, so a deployed server
    // cannot reach this branch.
    if (process.env.NODE_ENV !== 'production') {
      return 'dev-only-insecure-secret-for-local-agentforge';
    }

    throw new Error(
      'BETTER_AUTH_SECRET is not set. Sessions are signed with it, so without it ' +
        'approvals would be forgeable. Generate one with `openssl rand -base64 32`.',
    );
  }

  if (secret.length < 32) {
    throw new Error(
      `BETTER_AUTH_SECRET is ${String(secret.length)} characters; use at least 32. ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }

  return secret;
}

function createAuth() {
  return betterAuth({
    // The raw better-sqlite3 handle from the shared connection.
    database: getDb().$client,
    secret: authSecret(),
    baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',

    emailAndPassword: {
      enabled: true,
      // 12 is a floor, not a recommendation; the UI asks for more.
      minPasswordLength: 12,
      maxPasswordLength: 200,
      // No email transport is configured, so a reset link would go nowhere. Saying so is
      // better than offering a flow that silently fails.
      requireEmailVerification: false,
    },

    user: {
      additionalFields: {
        /**
         * Free-text role, shown beside a decision in the audit timeline.
         *
         * Display only: it is *not* an authorisation gate. The transition table's only
         * identity rule is `actor.type === 'human'`, and inventing a second gate here
         * would mean the governance story lived in two places. If approval ever needs to
         * be restricted to a role, that belongs in the transition table with the rest of
         * the rules, not in the auth layer.
         */
        role: {
          type: 'string',
          required: false,
          defaultValue: 'reviewer',
          input: true,
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    advanced: {
      // Approvals are state-changing POSTs, so same-site cookies are the first line of
      // CSRF defence and Better Auth's origin check is the second.
      defaultCookieAttributes: {
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
    },

    // Must be last: it lets server actions and route handlers set cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/**
 * The auth instance, built once on first use.
 *
 * Memoised rather than re-created per call: Better Auth holds the database handle and
 * the session machinery, and building it per request would mean a new Kysely wrapper
 * around the same SQLite connection on every single authenticated read.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export type Session = Auth['$Infer']['Session'];
