import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';

/**
 * Serving the marketing pages.
 *
 * These pages compose complete HTML documents rather than React trees, so they are
 * route handlers and not `page.tsx` files. That is deliberate and worth stating,
 * because it is the one place this app has two rendering styles:
 *
 * - the workspace is React, because it is an application with state, and
 * - the marketing site is server-rendered HTML with its own stylesheet, because it is a
 *   set of documents and gains nothing from hydration.
 *
 * Keeping them apart means the marketing CSS cannot leak into the workspace and the
 * workspace's fonts and tokens are not downloaded by someone reading the FAQ.
 *
 * The only thing these pages need from the application is whether someone is signed in,
 * which changes a nav link and nothing else. They resolve it through the same Better
 * Auth session as everything else — there is one notion of identity in this app, and a
 * second one living in the marketing layer is how two sources of truth begin.
 */

/** Whether this visitor is signed in. Never throws: a logged-out visitor is normal. */
export async function isSignedIn(): Promise<boolean> {
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    return session !== null;
  } catch {
    // A marketing page must render for someone who is not signed in, and it must also
    // render when the session store is unreachable. Treating an unavailable session as
    // "signed out" shows the public page, which is the safe direction to fail: the
    // alternative is a 500 on the front door. Nothing here grants access to anything —
    // every protected route resolves identity for itself.
    return false;
  }
}

/** A complete HTML document, with caching off because the nav depends on the session. */
export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** A relative redirect, which stays correct behind a proxy. */
export function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
