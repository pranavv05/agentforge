import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { getSpec, listClarifications } from '@agentforge/orchestrator';
import { AnswerForm } from './answer-form';

/**
 * The clarification round.
 *
 * The Requirement Agent is allowed to ask before it proposes, and this is where a human
 * answers. Answers are recorded with the account that gave them, because a requirement
 * written on the strength of an answer should be traceable to whoever made the call.
 *
 * Answered questions stay on the page rather than disappearing — the answer is part of
 * the reasoning behind the requirements, and hiding it would make the document look
 * like it arrived from nowhere.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spec = getSpec(getDb(), id);
  return { title: spec === undefined ? 'Clarifications' : `Clarifications · ${spec.title}` };
}

export default async function ClarificationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const spec = getSpec(db, id);
  if (spec === undefined) notFound();

  const clarifications = listClarifications(db, id);
  const unanswered = clarifications.filter((item) => item.answer === null);
  const answered = clarifications.filter((item) => item.answer !== null);

  const canAnswer = spec.status === 'REQ_AWAITING_CLARIFICATION';

  return (
    <>
      <div className="page__head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/specs">Specs</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/specs/${id}`}>{spec.title}</Link>
          <span aria-hidden="true">/</span>
          <span>clarifications</span>
        </nav>

        <h1 className="page__title">Clarifications</h1>
        <p className="page__lede">
          Questions the Requirement Agent raised before proposing. Your answers are recorded against
          your account and feed the next drafting round.
        </p>
      </div>

      {clarifications.length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No questions asked</h2>
          <p className="empty__body">
            The agent had enough to propose from the feature request alone.
          </p>
        </div>
      ) : (
        <>
          {unanswered.length > 0 && !canAnswer && (
            <div className="callout">
              <h2 className="callout__title">Not open for answers right now</h2>
              <p className="callout__body">
                These can only be answered while the spec is in{' '}
                <code>REQ_AWAITING_CLARIFICATION</code>; it is currently <code>{spec.status}</code>.
              </p>
            </div>
          )}

          {unanswered.length > 0 && canAnswer && (
            <AnswerForm
              specId={id}
              expectedVersion={spec.version}
              questions={unanswered.map((item) => ({
                id: item.id,
                question: item.question,
                whyItMatters: item.why_it_matters,
                options: item.options,
              }))}
            />
          )}

          {answered.length > 0 && (
            <section aria-label="Answered questions">
              <h2 className="hub__heading">Answered</h2>
              <ul className="qaList">
                {answered.map((item) => (
                  <li className="qa" key={item.id}>
                    <p className="qa__question">{item.question}</p>
                    <p className="qa__why">{item.why_it_matters}</p>
                    <p className="qa__answer">{item.answer}</p>
                    <p className="qa__meta">
                      round {item.round} · answered by {item.answered_by ?? 'unknown'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
