import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { getArtifactVersion, getSpec, listArtifactVersions } from '@agentforge/orchestrator';
import { isArtifactKind } from '@agentforge/contract';
import { diffLines } from '@/lib/diff';

/**
 * Version diff.
 *
 * Exists because of the hash binding rather than as a convenience. Editing an artifact
 * produces a new version with a new hash and invalidates any approval against the old
 * one, so "what changed since the version I approved?" is the question a reviewer has
 * every time they are asked to look again. Both hashes are shown for that reason.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}): Promise<Metadata> {
  const { kind } = await params;
  return { title: `${kind} diff` };
}

export default async function DiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id, kind } = await params;
  const { from, to } = await searchParams;

  if (!isArtifactKind(kind)) notFound();

  const db = getDb();
  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const versions = listArtifactVersions(db, id, kind);
  if (versions.length < 2) notFound();

  const latest = versions[versions.length - 1]?.version ?? 1;
  const previous = versions[versions.length - 2]?.version ?? 1;

  const fromVersion = Number(from ?? previous);
  const toVersion = Number(to ?? latest);

  const before = getArtifactVersion(db, id, kind, fromVersion);
  const after = getArtifactVersion(db, id, kind, toVersion);
  if (before === undefined || after === undefined) notFound();

  const hunks = diffLines(before.contentMd, after.contentMd);
  const added = hunks.flatMap((h) => h.lines).filter((l) => l.op === 'add').length;
  const removed = hunks.flatMap((h) => h.lines).filter((l) => l.op === 'remove').length;

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}/artifacts/${kind}`}>{kind}</Link>
          <span aria-hidden="true">/</span>
          <span>diff</span>
        </nav>

        <h1 className="page__title">
          v{before.version} → v{after.version}
        </h1>

        <p className="page__lede">
          <span className="diffStat diffStat--add">+{added}</span>{' '}
          <span className="diffStat diffStat--remove">−{removed}</span> · The hash changed from{' '}
          <code>{before.contentHash.slice(0, 12)}</code> to{' '}
          <code>{after.contentHash.slice(0, 12)}</code>, so any approval against the older version
          no longer applies.
        </p>
      </div>

      {hunks.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No textual difference</h2>
          <p className="empty__body">
            These two versions render identically, even though they are separate rows.
          </p>
        </div>
      ) : (
        <div className="diff">
          {hunks.map((hunk, hunkIndex) => (
            <div className="diff__hunk" key={`h${String(hunkIndex)}`}>
              <div className="diff__hunkHead mono">
                @@ −{hunk.from_start} +{hunk.to_start} @@
              </div>
              <pre className="diff__body">
                {hunk.lines.map((line, lineIndex) => (
                  <span
                    className={`diff__line diff__line--${line.op}`}
                    key={`h${String(hunkIndex)}l${String(lineIndex)}`}
                  >
                    <span className="diff__sign" aria-hidden="true">
                      {line.op === 'add' ? '+' : line.op === 'remove' ? '−' : ' '}
                    </span>
                    {line.text.length === 0 ? ' ' : line.text}
                  </span>
                ))}
              </pre>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
