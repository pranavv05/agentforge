import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '@agentforge/db';

/**
 * The marketing stylesheets, served from their one source.
 *
 * The server-rendered pages link `/static/style.css` and `/static/site.css`, while the
 * React landing page imports the same files from `components/site/`. They used to be two
 * hand-maintained copies in `public/` and `components/`, which drifted — and a
 * contrast fix applied to one silently missed the other, leaving half the site on the
 * old palette. There is now one file, and this route is how the HTML pages reach it.
 *
 * A closed allowlist rather than a path, because the file name comes from the URL:
 * anything not named here is a 404, so there is no way to read an arbitrary file by
 * asking for it.
 */

const FILES: Readonly<Record<string, string>> = {
  'style.css': 'apps/web/components/site/style.css',
  'site.css': 'apps/web/components/site/site.css',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const source = FILES[file];

  if (source === undefined) return new Response('Not found', { status: 404 });

  return new Response(readFileSync(resolve(REPO_ROOT, source), 'utf8'), {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      // Short, so an edit shows up without a hard refresh, long enough that a visitor
      // moving between pages does not re-download the stylesheet each time.
      'cache-control': 'public, max-age=300',
    },
  });
}
