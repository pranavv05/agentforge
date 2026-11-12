import { verifyClaim } from '@/lib/site/public-demo';
import { num, readBody, str } from '@/lib/site/public-body';

/**
 * A public demo endpoint.
 *
 * No account, no model call, no cost: every answer is a pure function of data this
 * repository already ships — the transition table, the hook's rule, or the compliance
 * pack. See `lib/site/public-demo.ts`.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request);
  return Response.json(
    verifyClaim({
      file: str(body['file']),
      line_start: num(body['line_start']),
      line_end: num(body['line_end']),
      symbol: str(body['symbol']),
    }),
  );
}
