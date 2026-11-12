import { html, isSignedIn, redirect } from '@/lib/site/page';
import { authPage } from '@/lib/site/auth';

/**
 * Sign in.
 *
 * A route handler rather than a `page.tsx`: this is a complete HTML document with the
 * marketing stylesheet, and it posts straight to Better Auth's own REST endpoints under
 * `/api/auth`. That is the same surface the workspace's React client uses, so there is
 * one sign-in path through the app and not two implementations to keep in step.
 *
 * Someone already signed in is sent to the workspace rather than shown a form they do
 * not need.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (await isSignedIn()) return redirect('/workspace');
  return html(authPage('login'));
}
