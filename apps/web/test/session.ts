import { expect } from 'vitest';

/**
 * A real signed-in session, for route tests.
 *
 * There is no test-only bypass of the auth gate anywhere in this suite, deliberately.
 * The audit log's job in this system is to prove that a *named human* approved a
 * specific content hash, so a suite that skipped authentication would be asserting that
 * property while avoiding the mechanism that establishes it. Every request these helpers
 * build carries a cookie minted by Better Auth from a real account in the test database.
 *
 * Import this *after* setting `SDD_DB_PATH`. It pulls in the auth config, which opens
 * the shared database connection on first use, so importing it earlier would bind the
 * session to the wrong file.
 */

export interface TestSession {
  /** The signed-in account's email, which is also the actor id in the audit log. */
  readonly email: string;
  /** Builds an authenticated request. */
  readonly req: (path: string, init?: RequestInit) => Request;
  /** Builds an unauthenticated request, for asserting the gate refuses it. */
  readonly anonReq: (path: string, init?: RequestInit) => Request;
}

const url = (path: string): string => `http://localhost:3000${path}`;

/**
 * Registers an account and returns helpers that carry its session.
 *
 * `email` defaults to the reviewer identity the suites assert on, so an audit row
 * written through HTTP and one written directly through the orchestrator name the same
 * actor.
 */
export async function createTestSession(
  email = 'reviewer@example.com',
  name = 'Reviewer',
): Promise<TestSession> {
  const { getAuth } = await import('@/lib/auth');
  const auth = getAuth();

  const response = await auth.api.signUpEmail({
    body: { email, password: 'route-test-password-long-enough', name },
    asResponse: true,
  });

  const header = response.headers.get('set-cookie');
  expect(header, `sign-up returned ${String(response.status)} and set no session cookie`).not.toBe(
    null,
  );

  // Only the name=value pair; the rest of the header is for a browser, not for us.
  const cookie = (header ?? '').split(';')[0] ?? '';

  return {
    email,
    req: (path, init) => {
      const headers = new Headers(init?.headers);
      headers.set('cookie', cookie);
      return new Request(url(path), { ...init, headers });
    },
    anonReq: (path, init) => new Request(url(path), init),
  };
}
