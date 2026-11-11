'use client';

import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { Auth } from './auth';

/**
 * The browser-side auth client.
 *
 * No `baseURL`: the client defaults to the current origin, which is what we want.
 * Pinning it to an environment variable would mean a deployment with a stale value
 * silently posting credentials at the wrong host.
 *
 * `inferAdditionalFields<Auth>()` is what teaches the client about `user.role`, which is
 * declared on the server config. Without it `signUp.email({ role })` does not typecheck,
 * and the field would be dropped. The `Auth` import is type-only, so the server module —
 * and with it `better-sqlite3` — is erased at build time and never reaches the browser
 * bundle.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
