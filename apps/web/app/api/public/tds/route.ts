import { computeTds } from '@/lib/site/public-demo';
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
    computeTds({
      category: str(body['category']),
      payee: str(body['payee']),
      amount: num(body['amount']),
    }),
  );
}
