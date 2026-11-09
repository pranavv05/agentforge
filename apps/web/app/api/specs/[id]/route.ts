import { GetSpecResponseSchema } from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import {
  listApprovals,
  listHeadArtifacts,
  listOpenClarifications,
  nextStates,
  requireSpecById,
} from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';
import { presentApproval, presentArtifact, presentSpec } from '@/lib/present';

/**
 * `GET /api/specs/:id` — everything a detail screen needs in one round trip.
 *
 * `available_transitions` comes from the real transition table, so the UI never offers
 * an action that would be refused: the state machine stays the single source of truth
 * rather than being re-implemented in the frontend.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const db = getDb();
    const spec = requireSpecById(db, id);

    return GetSpecResponseSchema.parse({
      spec: presentSpec(spec),
      artifacts: listHeadArtifacts(db, id).map(presentArtifact),
      approvals: listApprovals(db, id).map(presentApproval),
      open_clarifications: listOpenClarifications(db, id),
      available_transitions: nextStates(spec.status),
    });
  });
}
