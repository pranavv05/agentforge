import {
  DiffArtifactQuerySchema,
  DiffArtifactResponseSchema,
  NotFoundError,
  ValidationError,
  isArtifactKind,
} from '@agentforge/contract';
import { getDb } from '@agentforge/db';
import { getArtifactVersion, requireSpecById } from '@agentforge/orchestrator';
import { diffLines } from '@/lib/diff';
import { handle, parseQuery } from '@/lib/handler';

/**
 * `GET /api/specs/:id/artifacts/:kind/diff?from=1&to=2`
 *
 * Diffs the rendered markdown of two versions. Because the markdown is a pure function
 * of the payload, the diff a reviewer sees is exactly the change that moved the content
 * hash — and therefore exactly what invalidated any earlier approval.
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

    const { from, to } = parseQuery(request, DiffArtifactQuerySchema);
    const before = getArtifactVersion(db, id, kind, from);
    const after = getArtifactVersion(db, id, kind, to);

    for (const [version, row] of [
      [from, before],
      [to, after],
    ] as const) {
      if (row === undefined) {
        throw new NotFoundError(`${kind} version ${String(version)} does not exist`, {
          spec_id: id,
          kind,
          version,
        });
      }
    }

    return DiffArtifactResponseSchema.parse({
      kind,
      from_version: from,
      to_version: to,
      hunks: diffLines(before?.contentMd ?? '', after?.contentMd ?? ''),
    });
  });
}
