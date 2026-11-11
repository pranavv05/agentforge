import {
  DraftArtifactRequestSchema,
  DraftArtifactResponseSchema,
  TransitionError,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { generateTasks } from '@agentforge/agents';
import { requireSpecById } from '@agentforge/orchestrator';
import { handle, parseBody } from '@/lib/handler';
import { advanceTo } from '@/lib/advance';
import { presentArtifact, presentSpec } from '@/lib/present';

/**
 * `POST /api/specs/:id/tasks/generate` — run the Task Agent.
 *
 * Only reachable from `DESIGN_APPROVED`. Besides producing tasks.md, this is where the
 * compliance trace matrix is first computed end to end: tasks are the last hop of
 * rule to requirement to design to task, so until they exist the matrix can only show
 * gaps.
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
    advanceTo(db, spec, 'TASKS_GENERATED', correlationId);

    const result = await generateTasks(db, {
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
