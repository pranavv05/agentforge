import { GetAuditResponseSchema } from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { listAuditEntries, requireSpecById } from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';
import { presentAuditEntry } from '@/lib/present';

/**
 * `GET /api/specs/:id/audit` — the append-only timeline.
 *
 * Ordered by sequence number rather than timestamp, because several entries can share
 * a millisecond and the timeline has to be exact to be evidence.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await params;
    const db = getDb();
    requireSpecById(db, id);

    return GetAuditResponseSchema.parse({
      entries: listAuditEntries(db, id).map(presentAuditEntry),
    });
  });
}
