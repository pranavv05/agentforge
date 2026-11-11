import {
  DraftArtifactRequestSchema,
  DraftArtifactResponseSchema,
  TransitionError,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { draftDesign } from '@agentforge/agents';
import { requireSpecById } from '@agentforge/orchestrator';
import { handle, parseBody } from '@/lib/handler';
import { advanceTo } from '@/lib/advance';
import { presentArtifact, presentSpec } from '@/lib/present';

/**
 * `POST /api/specs/:id/design/draft` — run the Design Agent.
 *
 * Only reachable from `DESIGN_DRAFTING`, which the orchestrator refuses to enter unless
 * the approved requirements are still the version a human signed off. So a design is
 * always designed against approved content, by construction rather than by convention.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async ({ correlationId }) => {
    const { id } = await params;
    const body = await parseBody(request, DraftArtifactRequestSchema);
    const db = getDb();

    const spec = requireSpecById(db, id);
    if (spec.version !== body.expected_version) {
      throw new TransitionError(
        'VERSION_CONFLICT',
        `spec version is ${String(spec.version)}, caller expected ${String(body.expected_version)}`,
        { spec_id: id, actual_version: spec.version, expected_version: body.expected_version },
      );
    }

    // Move into the working state first, as the orchestrator. Without this nothing
    // over HTTP could start the stage — see lib/advance.ts.
    advanceTo(db, spec, 'DESIGN_DRAFTING', correlationId);

    const result = await draftDesign(db, {
      specId: id,
      idempotencyKey: body.idempotency_key,
      correlationId,
    });

    return DraftArtifactResponseSchema.parse({
      spec: presentSpec(result.spec),
      artifact: presentArtifact(result.artifact),
      clarifications: [],
    });
  });
}
