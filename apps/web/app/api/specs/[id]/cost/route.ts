import { GetCostResponseSchema } from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { getCostSummary, requireSpecById } from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';

/**
 * `GET /api/specs/:id/cost` — measured spend, not an estimate.
 *
 * Every figure comes from `llm_calls`, including the cache hit rate. These are the
 * numbers that replace the plan's projected per-feature costs.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await params;
    const db = getDb();
    requireSpecById(db, id);

    return GetCostResponseSchema.parse({ cost: getCostSummary(db, id) });
  });
}
