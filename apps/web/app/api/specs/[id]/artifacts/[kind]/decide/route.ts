import {
  DecideArtifactRequestSchema,
  DecideArtifactResponseSchema,
  NotFoundError,
  ValidationError,
  isArtifactKind,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { decideArtifact, listApprovals } from '@agentforge/orchestrator';
import { requestActor } from '@/lib/actor';
import { handle, parseBody } from '@/lib/handler';
import { presentApproval, presentSpec } from '@/lib/present';

/**
 * `POST /api/specs/:id/artifacts/:kind/decide` — the human approval gate.
 *
 * The request must carry the content hash the reviewer saw. If the artifact has moved
 * on since the page was rendered, this returns 409 `HASH_MISMATCH` and nothing is
 * recorded: a reviewer can only ever approve the bytes they actually read.
 *
 * The actor is always a `human` (see lib/actor.ts), so no API caller can impersonate an
 * agent to slip past a human-only transition.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  return handle(async ({ correlationId }) => {
    const { id, kind } = await params;
    if (!isArtifactKind(kind)) {
      throw new ValidationError(`"${kind}" is not an artifact kind`, { kind });
    }

    const body = await parseBody(request, DecideArtifactRequestSchema);
    const db = getDb();

    const result = decideArtifact(db, {
      specId: id,
      kind,
      contentHash: body.content_hash,
      decision: body.decision,
      comment: body.comment,
      actor: requestActor(request),
      expectedVersion: body.expected_version,
      correlationId,
    });

    const approval = listApprovals(db, id).find((a) => a.id === result.approvalId);
    if (approval === undefined) {
      throw new NotFoundError('the recorded decision could not be read back', {
        approval_id: result.approvalId,
      });
    }

    return DecideArtifactResponseSchema.parse({
      spec: presentSpec(result.spec),
      approval: presentApproval(approval),
    });
  });
}
