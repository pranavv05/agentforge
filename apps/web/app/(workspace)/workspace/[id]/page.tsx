import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import {
  evidenceStats,
  listEvidence,
  listTasks,
  getArtifactVersion,
  getCostSummary,
  getHeadArtifact,
  getSpec,
  listArtifactVersions,
} from '@agentforge/orchestrator';
import {
  APPROVAL_STATE_FOR_ARTIFACT,
  isArtifactKind,
  type ArtifactKind,
} from '@agentforge/contract';
import { buildThread } from '@/lib/thread';
import { Thread } from '@/components/workspace/thread';
import { DocumentPane } from '@/components/workspace/document-pane';
import { ThreadFooter } from '@/components/workspace/thread-footer';
import { runActivity } from '@/lib/activity';
import { ThreadHeader } from '@/components/workspace/thread-header';

/**
 * One thread.
 *
 * The conversation on the left, and — when an artifact is open via `?doc=` — the
 * document pane on the right. Which document is open lives in the URL rather than in
 * component state, so a reviewer can link a colleague straight to the thing they want
 * looked at, and the back button does what it should.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  // A missing spec renders the not-found screen, so the tab should say so rather than
  // calling an error page "Thread".
  return { title: spec?.title ?? 'Spec not found' };
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string; v?: string }>;
}) {
  const { id } = await params;
  const { doc, v } = await searchParams;

  const db = getDb();
  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const items = buildThread(db, id);
  const cost = getCostSummary(db, id);
  const evidence = evidenceStats(db, id);

  // Which artifact the pane is showing, if any.
  const openKind: ArtifactKind | null = doc !== undefined && isArtifactKind(doc) ? doc : null;

  const paneData = (() => {
    if (openKind === null) return null;

    const versions = listArtifactVersions(db, id, openKind);
    if (versions.length === 0) return null;

    const head = getHeadArtifact(db, id, openKind);
    if (head === undefined) return null;

    const requested = v === undefined ? Number.NaN : Number(v);
    const artifact = Number.isNaN(requested)
      ? head
      : (getArtifactVersion(db, id, openKind, requested) ?? head);

    // The gate comes from the contract's own table, not a list written here: a pane that
    // offered an approve button in a state the orchestrator refuses would teach a
    // reviewer that the interface does not know the rules.
    const gateState = APPROVAL_STATE_FOR_ARTIFACT[openKind];

    return {
      kind: openKind,
      contentMd: artifact.contentMd,
      contentHash: artifact.contentHash,
      version: artifact.version,
      versions: versions.map((row) => ({
        version: row.version,
        contentHash: row.contentHash,
      })),
      isHead: artifact.version === head.version,
      atGate: gateState !== null && spec.status === gateState,
    };
  })();

  return (
    <main id="main" tabIndex={-1} className={`stage${paneData === null ? '' : ' stage--split'}`}>
      <section className="thread" aria-label="Conversation">
        <ThreadHeader
          title={spec.title}
          status={spec.status}
          mode={spec.mode}
          costUsd={cost.total_cost_usd}
          calls={cost.call_count}
          unverifiedRate={evidence.total === 0 ? null : evidence.unverifiedClaimRate}
        />

        <div className="thread__scroll">
          <Thread
            items={items}
            specId={id}
            specVersion={spec.version}
            openKind={openKind}
            canAnswer={spec.status === 'REQ_AWAITING_CLARIFICATION'}
          />
        </div>

        <ThreadFooter
          specId={id}
          status={spec.status}
          specVersion={spec.version}
          mode={spec.mode}
          activity={runActivity(db, id, spec.status, items)}
          openQuestions={items.filter((i) => i.type === 'question' && i.answer === null).length}
        />
      </section>

      {paneData !== null && (
        <DocumentPane
          specId={id}
          kind={paneData.kind}
          contentMd={paneData.contentMd}
          contentHash={paneData.contentHash}
          version={paneData.version}
          versions={paneData.versions}
          isHead={paneData.isHead}
          atGate={paneData.atGate}
          specVersion={spec.version}
          specStatus={spec.status}
          evidence={openKind === 'context' ? listEvidence(db, id) : []}
          tasks={openKind === 'tasks' ? listTasks(db, id) : []}
        />
      )}
    </main>
  );
}
