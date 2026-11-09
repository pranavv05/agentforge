import { ListClarificationsResponseSchema } from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { listClarifications, requireSpecById } from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';

/** `GET /api/specs/:id/clarifications` — every round, answered and open. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    requireSpecById(db, id);

    return ListClarificationsResponseSchema.parse({
      clarifications: listClarifications(db, id),
    });
  });
}
