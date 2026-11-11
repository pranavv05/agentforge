import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import {
  evidenceStats,
  getCostSummary,
  getSpec,
  listAuditEntries,
  listClarifications,
  listHeadArtifacts,
  listTasks,
  nextStates,
} from '@agentforge/orchestrator';
import {
  ARTIFACT_KINDS,
  isAwaitingHuman,
  type ArtifactKind,
  type TaskStatus,
} from '@agentforge/contract';
import { Pipeline } from '@/components/ui/pipeline';

/**
 * The spec hub.
 *
 * Everything about one spec reachable from one screen, arranged around the question a
 * reviewer actually arrives with: what is the state of this, and is there something
 * here for me to decide?
 *
 * So the gate comes first. If the spec is waiting on a human, the decision panel is the
 * first thing below the title; if it is not, the page leads with where it has got to.
 * The orchestrator's own `nextStates` is used to describe what can happen next, rather
 * than a list hard-coded in the UI — a screen that disagreed with the transition table
 * would be worse than no screen at all.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  return { title: spec?.title ?? 'Spec' };
}

/**
 * Badge treatment per task status.
 *
 * A total record rather than a chain of ternaries, so adding a status to the contract is
 * a compile error here instead of a task silently rendering as the default.
 */
const TASK_BADGE: Record<TaskStatus, string> = {
  pending: 'plain',
  in_progress: 'accent',
  completed: 'ok',
  blocked: 'danger',
};

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  context: 'Context',
  requirements: 'Requirements',
  design: 'Design',
  tasks: 'Tasks',
};

export default async function SpecPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const artifacts = listHeadArtifacts(db, id);
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));

  const cost = getCostSummary(db, id);
  const evidence = evidenceStats(db, id);
  const audit = listAuditEntries(db, id);
  const clarifications = listClarifications(db, id);
  const tasks = listTasks(db, id);

  const unanswered = clarifications.filter((item) => item.answer === null);
  const next = nextStates(spec.status);
  const awaiting = isAwaitingHuman(spec.status);

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <span>{spec.title}</span>
        </nav>

        <div className="specHead">
          <h1 className="page__title">{spec.title}</h1>
          <span className={awaiting ? 'state state--awaiting' : 'state'}>{spec.status}</span>
        </div>

        <p className="page__lede">{spec.description}</p>

        <div className="specRow__meta">
          <span>{spec.mode}</span>
          <span>v{spec.version}</span>
          {spec.repoPath !== null && <code>{spec.repoPath}</code>}
        </div>
      </div>

      <Pipeline status={spec.status} mode={spec.mode} />

      {awaiting && (
        <div className="callout callout--accent">
          <h2 className="callout__title">This spec is waiting on a decision</h2>
          <p className="callout__body">
            Open the artifact under review to approve it, request changes, or reject it. An approval
            binds to the content hash shown there, so editing the artifact afterwards invalidates
            it.
          </p>
        </div>
      )}

      {unanswered.length > 0 && (
        <div className="callout">
          <h2 className="callout__title">
            {unanswered.length} unanswered question{unanswered.length === 1 ? '' : 's'}
          </h2>
          <p className="callout__body">
            The Requirement Agent asked for clarification before it will propose.
          </p>
          <Link className="btn btn--primary btn--sm" href={`/specs/${id}/clarifications`}>
            Answer them
          </Link>
        </div>
      )}

      <div className="hub">
        <section className="hub__main" aria-label="Artifacts">
          <h2 className="hub__heading">Artifacts</h2>

          <ul className="artifacts">
            {ARTIFACT_KINDS.map((kind) => {
              const artifact = byKind.get(kind);

              return (
                <li className="artifactRow" key={kind}>
                  <div className="artifactRow__main">
                    <h3 className="artifactRow__title">
                      {artifact === undefined ? (
                        ARTIFACT_LABEL[kind]
                      ) : (
                        <Link href={`/specs/${id}/artifacts/${kind}`}>{ARTIFACT_LABEL[kind]}</Link>
                      )}
                    </h3>

                    {artifact === undefined ? (
                      <p className="artifactRow__empty">Not produced yet.</p>
                    ) : (
                      <p className="artifactRow__meta">
                        v{artifact.version} · <code>{artifact.contentHash.slice(0, 12)}</code> ·
                        written by {artifact.createdBy}
                      </p>
                    )}
                  </div>

                  {artifact !== undefined && (
                    <Link
                      className="btn btn--ghost btn--sm"
                      href={`/specs/${id}/artifacts/${kind}`}
                    >
                      Review
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {tasks.length > 0 && (
            <>
              <h2 className="hub__heading">Tasks</h2>
              <ul className="taskList">
                {tasks.map((task) => (
                  <li className="taskRow" key={task.id}>
                    <code className="taskRow__key">{task.task_key}</code>
                    <span className="taskRow__title">{task.title}</span>
                    <span className={`badge badge--${TASK_BADGE[task.status]}`}>{task.status}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <aside className="hub__side" aria-label="Spec details">
          <div className="panel panel--pad sideCard">
            <h2 className="sideCard__title">Next moves</h2>
            <p className="sideCard__note">
              What the orchestrator would accept from <code>{spec.status}</code>.
            </p>
            {next.length === 0 ? (
              <p className="sideCard__value">Terminal — nothing follows.</p>
            ) : (
              <ul className="sideCard__list">
                {next.map((state) => (
                  <li key={state}>
                    <code>{state}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel panel--pad sideCard">
            <h2 className="sideCard__title">Cost</h2>
            <p className="sideCard__big tabular">${cost.total_cost_usd.toFixed(4)}</p>
            <dl className="sideCard__rows">
              <div>
                <dt>model calls</dt>
                <dd className="tabular">{cost.call_count}</dd>
              </div>
              <div>
                <dt>cache hit rate</dt>
                <dd className="tabular">{(cost.cache_hit_rate * 100).toFixed(1)}%</dd>
              </div>
            </dl>
            <p className="sideCard__note">
              Measured from <code>llm_calls</code>, not estimated.
            </p>
          </div>

          {evidence.total > 0 && (
            <div className="panel panel--pad sideCard">
              <h2 className="sideCard__title">Grounding</h2>
              <p className="sideCard__big tabular">
                {(evidence.unverifiedClaimRate * 100).toFixed(1)}%
              </p>
              <p className="sideCard__note">unverified-claim rate</p>
              <dl className="sideCard__rows">
                <div>
                  <dt>verified</dt>
                  <dd className="tabular">{evidence.verified}</dd>
                </div>
                <div>
                  <dt>unverified</dt>
                  <dd className="tabular">{evidence.unverified}</dd>
                </div>
              </dl>
              <Link className="sideCard__link" href={`/specs/${id}/context`}>
                See the evidence →
              </Link>
            </div>
          )}

          <div className="panel panel--pad sideCard">
            <h2 className="sideCard__title">Trail</h2>
            <ul className="sideCard__list">
              <li>
                <Link className="sideCard__link" href={`/specs/${id}/audit`}>
                  Audit timeline ({audit.length}) →
                </Link>
              </li>
              <li>
                <Link className="sideCard__link" href={`/specs/${id}/clarifications`}>
                  Clarifications ({clarifications.length}) →
                </Link>
              </li>
              <li>
                <Link className="sideCard__link" href={`/specs/${id}/compliance`}>
                  Compliance trace →
                </Link>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
