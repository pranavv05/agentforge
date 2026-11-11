import {
  DraftArtifactRequestSchema,
  DraftArtifactResponseSchema,
  TransitionError,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { draftRequirements } from '@agentforge/agents';
import { listOpenClarifications, requireSpecById } from '@agentforge/orchestrator';
import { handle, parseBody } from '@/lib/handler';
import { presentArtifact, presentSpec } from '@/lib/present';

/**
 * `POST /api/specs/:id/requirements/draft` — run the Requirement Agent.
 *
 * Returns either the proposed artifact or the questions the agent needs answered. The
 * call is idempotent on `idempotency_key`: a client timeout and retry returns the
 * artifact the first attempt produced rather than drafting again or failing a state
 * guard.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async ({ correlationId }) => {
    const { id } = await params;
    const body = await parseBody(request, DraftArtifactRequestSchema);
    const db = getDb();

    // The caller's view of the spec must be current, or it is acting on a stale page.
    const spec = requireSpecById(db, id);
    if (spec.version !== body.expected_version) {
      throw new TransitionError(
        'VERSION_CONFLICT',
        `spec version is ${String(spec.version)}, caller expected ${String(body.expected_version)}`,
        { spec_id: id, actual_version: spec.version, expected_version: body.expected_version },
      );
    }

    const result = await draftRequirements(db, {
      specId: id,
      idempotencyKey: body.idempotency_key,
      correlationId,
    });

    return DraftArtifactResponseSchema.parse({
      spec: presentSpec(result.spec),
      artifact: result.outcome === 'proposed' ? presentArtifact(result.artifact) : null,
      clarifications:
        result.outcome === 'clarification_requested'
          ? result.clarifications
          : listOpenClarifications(db, id),
    });
  });
}
