import { sampleFile } from '@/lib/site/public-demo';

/**
 * A public demo endpoint.
 *
 * No account, no model call, no cost: every answer is a pure function of data this
 * repository already ships — the transition table, the hook's rule, or the compliance
 * pack. See `lib/site/public-demo.ts`.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  const file = sampleFile(path);

  return file === null
    ? Response.json({ error: 'that file is not one of the samples' }, { status: 404 })
    : Response.json(file);
}
