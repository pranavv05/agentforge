import { statesPayload } from '@/lib/site/public-demo';

/**
 * A public demo endpoint.
 *
 * No account, no model call, no cost: every answer is a pure function of data this
 * repository already ships — the transition table, the hook's rule, or the compliance
 * pack. See `lib/site/public-demo.ts`.
 */

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(statesPayload());
}
