import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import {
  getSpec,
  getHeadArtifact,
  getArtifactVersion,
  listApprovals,
  listArtifactVersions,
} from '@agentforge/orchestrator';
import {
  APPROVAL_STATE_FOR_ARTIFACT,
  isArtifactKind,
  type ArtifactKind,
} from '@agentforge/contract';
import { Markdown } from '@/components/ui/markdown';
import { DecidePanel } from './decide-panel';

/**
 * The artifact viewer.
 *
 * Shows the rendered document, its version history, and — only when the spec is actually
 * sitting at this artifact's approval gate — the decision panel.
 *
 * The condition for showing that panel is taken from the contract's own
 * `APPROVAL_STATE_FOR_ARTIFACT` table rather than written out here. A screen that
 * offered an approve button in a state the orchestrator would refuse is worse than one
 * that offers nothing: the reviewer clicks, gets a 409, and learns that the interface
 * does not know the rules.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}): Promise<Metadata> {
  const { kind } = await params;
  return { title: isArtifactKind(kind) ? `${kind} artifact` : 'Artifact' };
}

export default async function ArtifactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id, kind } = await params;
  const { version } = await searchParams;

  if (!isArtifactKind(kind)) notFound();
  const artifactKind: ArtifactKind = kind;

  const db = getDb();
  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const versions = listArtifactVersions(db, id, artifactKind);
  if (versions.length === 0) notFound();

  const head = getHeadArtifact(db, id, artifactKind);
  const requested = version === undefined ? undefined : Number(version);
  const artifact =
    requested === undefined || Number.isNaN(requested)
      ? head
      : getArtifactVersion(db, id, artifactKind, requested);

  if (artifact === undefined || head === undefined) notFound();

  const approvals = listApprovals(db, id).filter((row) => row.artifactKind === artifactKind);
  const isHead = artifact.version === head.version;

  // The gate this artifact waits at, straight from the contract's table.
  const gateState = APPROVAL_STATE_FOR_ARTIFACT[artifactKind];
  const atGate = gateState !== null && spec.status === gateState;

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <span>{artifactKind}</span>
        </nav>

        <div className="specHead">
          <h1 className="page__title">{artifactKind}</h1>
          <span className="badge badge--plain">v{artifact.version}</span>
          {!isHead && <span className="badge badge--warn">not the current version</span>}
        </div>

        {/*
          The full hash, selectable, but shown at a size that does not compete with the
          title. It is here because an approval binds to it: a reviewer should be able to
          see and copy exactly what they are about to sign off on.
        */}
        <p className="hashLine">
          <span className="hashLine__label">content hash</span>
          <code>{artifact.contentHash}</code>
        </p>
      </div>

      <div className="hub">
        <article className="hub__main doc" aria-label={`${artifactKind} document`}>
          <Markdown source={artifact.contentMd} />
        </article>

        <aside className="hub__side" aria-label="Versions and decisions">
          {atGate && isHead && (
            <DecidePanel
              specId={id}
              kind={artifactKind}
              contentHash={artifact.contentHash}
              version={artifact.version}
              expectedVersion={spec.version}
            />
          )}

          {atGate && !isHead && (
            <div className="callout">
              <h2 className="callout__title">Viewing an older version</h2>
              <p className="callout__body">
                Decisions bind to a content hash, so only the current version can be approved.{' '}
                <Link href={`/specs/${id}/artifacts/${artifactKind}`}>Go to v{head.version}</Link>.
              </p>
            </div>
          )}

          <div className="panel panel--pad sideCard">
            <h2 className="sideCard__title">Versions</h2>
            <ul className="sideCard__list">
              {versions.map((row) => (
                <li key={row.version}>
                  <Link
                    className="sideCard__link"
                    href={`/specs/${id}/artifacts/${artifactKind}?version=${String(row.version)}`}
                    aria-current={row.version === artifact.version ? 'page' : undefined}
                  >
                    v{row.version}
                  </Link>{' '}
                  <span className="sideCard__note">
                    <code>{row.contentHash.slice(0, 10)}</code>
                  </span>
                </li>
              ))}
            </ul>

            {versions.length > 1 && (
              <Link
                className="sideCard__link"
                href={`/specs/${id}/artifacts/${artifactKind}/diff?from=${String(
                  versions[versions.length - 2]?.version ?? 1,
                )}&to=${String(head.version)}`}
              >
                Compare the last two →
              </Link>
            )}
          </div>

          {approvals.length > 0 && (
            <div className="panel panel--pad sideCard">
              <h2 className="sideCard__title">Decisions</h2>
              <ul className="decisions">
                {approvals.map((approval) => (
                  <li className="decisionRow" key={approval.id}>
                    <span
                      className={`badge badge--${approval.decision === 'approve' ? 'ok' : 'warn'}`}
                    >
                      {approval.decision.replace('_', ' ')}
                    </span>
                    <span className="decisionRow__who">{approval.actor}</span>
                    <code className="decisionRow__hash">{approval.contentHash.slice(0, 10)}</code>
                    {approval.comment !== null && (
                      <p className="decisionRow__comment">{approval.comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
