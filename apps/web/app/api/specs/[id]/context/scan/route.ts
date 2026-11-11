import {
  ScanContextRequestSchema,
  ScanContextResponseSchema,
  TransitionError,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { scanContext } from '@agentforge/context-agent';
import { requireSpecById } from '@agentforge/orchestrator';
import { handle, parseBody } from '@/lib/handler';
import { presentSpec } from '@/lib/present';

/**
 * `POST /api/specs/:id/context/scan` — run the Context Agent over the spec's repository.
 *
 * Runs stages 0 to 3: the deterministic scan, cached module summaries, the budgeted
 * agentic loop, and then the grounding verifier. It returns the verified bundle,
 * including the unverified-claim rate, so the caller sees the measurement rather than
 * having to trust the claims.
 *
 * `max_tool_calls` may lower the budget but never raise it past the server's ceiling:
 * the cap is the server's to enforce, not the caller's to choose.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async ({ correlationId }) => {
    const { id } = await params;
    const body = await parseBody(request, ScanContextRequestSchema);
    const db = getDb();

    const spec = requireSpecById(db, id);
    if (spec.version !== body.expected_version) {
      throw new TransitionError(
        'VERSION_CONFLICT',
        `spec version is ${String(spec.version)}, caller expected ${String(body.expected_version)}`,
        { spec_id: id, actual_version: spec.version, expected_version: body.expected_version },
      );
    }

    const result = await scanContext(db, {
      specId: id,
      // A scan is the most expensive operation here, so a retry must replay rather than
      // re-explore. Keyed on the spec version the caller expected, which is stable
      // across a client timeout and retry but changes once the spec actually moves.
      idempotencyKey: `scan:${body.strategy}:v${String(body.expected_version)}`,
      strategy: body.strategy,
      ...(body.max_tool_calls === null ? {} : { maxToolCalls: body.max_tool_calls }),
      correlationId,
    });

    return ScanContextResponseSchema.parse({
      spec: presentSpec(requireSpecById(db, id)),
      bundle: result.bundle,
    });
  });
}
