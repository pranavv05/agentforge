import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { getSpec, listApprovals, listAuditEntries } from '@agentforge/orchestrator';
import type { ActorType } from '@agentforge/contract';

/**
 * The audit timeline.
 *
 * The screen the whole governance claim is ultimately checked against, so it is built to
 * be read sceptically rather than skimmed. Three things are deliberate:
 *
 * **The actor type is shown on every row, not just the name.** The claim is not "a
 * decision was recorded" but "no agent signed off its own output", and that is only
 * visible if you can see which rows were written by a human, which by an agent, and
 * which by the orchestrator.
 *
 * **Approvals show the hash they bound to.** A row saying "approved" means little; a row
 * saying which bytes were approved is evidence.
 *
 * **Nothing here is editable, and the page says so.** The append-only guarantee lives in
 * database triggers, and stating it on the screen that displays the log is where a
 * reader will actually encounter it.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  return { title: spec === undefined ? 'Audit' : `Audit · ${spec.title}` };
}

/** Total over ActorType, so a new actor kind is a compile error rather than a blank badge. */
/**
 * Reads one optional string out of an audit payload.
 *
 * The payload is a JSON column: its shape varies by transition and it is `unknown` by
 * the time it reaches here. Two fields are wanted for display, so this narrows rather
 * than asserting — a payload missing the key, or carrying a non-string, renders nothing
 * instead of a cast that happens to be wrong.
 */
function payloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Total over ActorType, so a new actor kind is a compile error rather than a blank badge. */
const ACTOR_BADGE: Record<ActorType, string> = {
  human: 'badge--ok',
  agent: 'badge--info',
  orchestrator: 'badge--plain',
  system: 'badge--plain',
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const entries = listAuditEntries(db, id);
  const approvals = listApprovals(db, id);

  // Approvals are keyed by the state they produced, so a row that recorded a decision
  // can show the hash that decision bound to.
  const approvalByHash = new Map(approvals.map((approval) => [approval.id, approval]));

  const humans = entries.filter((entry) => entry.actorType === 'human').length;
  const agents = entries.filter((entry) => entry.actorType === 'agent').length;

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <span>audit</span>
        </nav>

        <h1 className="page__title">Audit timeline</h1>
        <p className="page__lede">
          {entries.length} transition{entries.length === 1 ? '' : 's'} — {humans} by a human,{' '}
          {agents} by an agent, {entries.length - humans - agents} by the orchestrator. Append-only
          at the database level: <code>UPDATE</code> is refused unconditionally and{' '}
          <code>DELETE</code> while the spec exists, so even direct SQL cannot rewrite what is
          below.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">Nothing recorded yet</h2>
          <p className="empty__body">
            Every state change appends a row here, with the actor that caused it.
          </p>
        </div>
      ) : (
        <ol className="timeline">
          {entries.map((entry) => {
            const approvalId = payloadString(entry.payload, 'approval_id');
            const approval = approvalId === null ? undefined : approvalByHash.get(approvalId);
            const hash = approval?.contentHash ?? payloadString(entry.payload, 'content_hash');

            return (
              <li className="event" key={entry.id}>
                <div className="event__rail" aria-hidden="true">
                  <span className={`event__dot event__dot--${entry.actorType}`} />
                </div>

                <div className="event__body">
                  <div className="event__head">
                    <span className="event__states mono">
                      {entry.fromState ?? '—'} <span aria-hidden="true">→</span>{' '}
                      <strong>{entry.toState}</strong>
                    </span>
                    <span className={`badge ${ACTOR_BADGE[entry.actorType]}`}>
                      {entry.actorType}
                    </span>
                  </div>

                  <p className="event__actor">{entry.actor}</p>

                  {entry.reason !== null && entry.reason.length > 0 && (
                    <p className="event__reason">{entry.reason}</p>
                  )}

                  {approval?.comment != null && approval.comment.length > 0 && (
                    <p className="event__reason">“{approval.comment}”</p>
                  )}

                  <div className="event__meta">
                    <time dateTime={entry.createdAt}>{entry.createdAt.replace('T', ' ')}</time>
                    {hash !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          bound to <code>{hash.slice(0, 12)}</code>
                        </span>
                      </>
                    )}
                    {entry.correlationId.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <code>{entry.correlationId}</code>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
