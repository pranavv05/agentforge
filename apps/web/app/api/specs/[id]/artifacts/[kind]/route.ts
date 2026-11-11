import {
  GetArtifactQuerySchema,
  GetArtifactResponseSchema,
  NotFoundError,
  ValidationError,
  isArtifactKind,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import {
  getArtifactVersion,
  getHeadArtifact,
  listArtifactVersions,
  requireSpecById,
} from '@agentforge/orchestrator';
import { handle, parseQuery } from '@/lib/handler';
import { presentArtifact } from '@/lib/present';

/**
 * `GET /api/specs/:id/artifacts/:kind` — one artifact version plus its history.
 *
 * Defaults to the head version. The history drives the version picker and the diff
 * view, and every entry carries its content hash so the UI can show a reviewer exactly
 * which bytes an approval was bound to.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  return handle(request, async () => {
    const { id, kind } = await params;
    if (!isArtifactKind(kind)) {
      throw new ValidationError(`"${kind}" is not an artifact kind`, { kind });
    }

    const db = getDb();
    requireSpecById(db, id);

    const query = parseQuery(request, GetArtifactQuerySchema);
    const artifact =
      query.version === null
        ? getHeadArtifact(db, id, kind)
        : getArtifactVersion(db, id, kind, query.version);

    if (artifact === undefined) {
      throw new NotFoundError(
        query.version === null
          ? `no ${kind} artifact exists for this spec yet`
          : `${kind} version ${String(query.version)} does not exist`,
        { spec_id: id, kind, version: query.version },
      );
    }

    return GetArtifactResponseSchema.parse({
      artifact: presentArtifact(artifact),
      history: listArtifactVersions(db, id, kind).map((row) => ({
        id: row.id,
        version: row.version,
        content_hash: row.contentHash,
        created_at: row.createdAt,
        created_by: row.createdBy,
      })),
    });
  });
}
