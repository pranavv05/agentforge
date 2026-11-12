import { html, isSignedIn } from '@/lib/site/page';
import { resourceToolPage } from '@/lib/site/site';
import { authPage } from '@/lib/site/auth';

/**
 * A marketing page.
 *
 * A route handler rather than a `page.tsx` because these pages are complete HTML
 * documents with their own stylesheet, not React trees — see `lib/site/page.ts` for
 * why the marketing site and the workspace render differently on purpose.
 *
 * `force-dynamic` because the nav shows either "Sign in" or "Open dashboard", which
 * depends on the visitor's session.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const body = resourceToolPage(slug, await isSignedIn());
  return body === null ? html(authPage('notfound'), 404) : html(body);
}
