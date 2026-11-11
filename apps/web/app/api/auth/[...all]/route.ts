import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

/**
 * `/api/auth/*` — Better Auth's own endpoints (sign-up, sign-in, sign-out, session).
 *
 * Owned by the library: the paths, request shapes and responses under here are its
 * contract, not ours, which is why they have no entry in `packages/contract`. That
 * package describes the spec API — the surface the frontend and the examiners reason
 * about — and extending it to mirror a dependency's routes would make it describe
 * something this project does not control. `apps/web/test/routes.test.ts` names this
 * prefix as library-owned for the same reason.
 *
 * Nothing here can move a spec. Authentication establishes *who* a caller is; whether
 * that caller may do anything is decided by the orchestrator's transition table, which
 * these endpoints never touch.
 *
 * The handler is built per request rather than at module scope, because the build
 * evaluates this module to collect route configuration and the auth instance must not
 * be constructed — or read the session secret, or open the database — while compiling.
 */
export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}

// Node, not edge: it reads and writes SQLite through the shared connection.
export const runtime = 'nodejs';
