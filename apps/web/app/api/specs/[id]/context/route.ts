import { ContextBundleSchema, GetContextResponseSchema } from '@agentforge/contract';
import { getDb, parseJsonColumn } from '@agentforge/db';
import { getHeadArtifact, requireSpecById } from '@agentforge/orchestrator';
import { handle } from '@/lib/handler';

/**
 * `GET /api/specs/:id/context` — the verified context bundle.
 *
 * Returns `null` rather than 404 when no scan has run: a greenfield spec legitimately
 * has no context, and the UI should render an empty state, not an error.
 *
 * The bundle carries the unverified-claim rate alongside each claim's verification
 * result, which is what the verified/unverified badges render from.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await params;
    const db = getDb();
    requireSpecById(db, id);

    const artifact = getHeadArtifact(db, id, 'context');
    if (artifact === undefined) {
      return GetContextResponseSchema.parse({ bundle: null });
    }

    return GetContextResponseSchema.parse({
      bundle: parseJsonColumn(
        ContextBundleSchema,
        artifact.contentJson,
        `artifact_versions.content_json (context v${String(artifact.version)})`,
      ),
    });
  });
}
