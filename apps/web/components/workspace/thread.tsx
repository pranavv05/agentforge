import Link from 'next/link';
import type { ArtifactKind } from '@agentforge/contract';
import type { ThreadItem } from '@/lib/thread';
import { AnswerInline } from '@/components/workspace/answer-inline';

/**
 * The thread.
 *
 * Renders the derived conversation. Every item here corresponds to a durable row — see
 * `lib/thread.ts` — so nothing in this view can show something that did not happen.
 *
 * Two deliberate restraints:
 *
 * **Agent turns are not speech bubbles.** They are activity lines, because that is what
 * they are: a state change, with the actor that caused it. Dressing a database
 * transition up as the agent "saying" something would be inventing a voice the system
 * does not have.
 *
 * **An artifact is a card with a handoff, not its contents.** The card carries real
 * counts and the hash; reading and approving happen in the document pane. A reviewer
 * should not be able to approve sixteen requirements without opening them.
 */

const KIND_LABEL: Record<ArtifactKind, string> = {
  context: 'context.md',
  requirements: 'requirements.md',
  design: 'design.md',
  tasks: 'tasks.md',
};

/** Human phrasing for a transition, from the state it reached. */
function describe(toState: string): string {
  const map: Record<string, string> = {
    CONTEXT_SCANNING: 'Scanning the repository',
    CONTEXT_READY: 'Finished scanning',
    REQ_DRAFTING: 'Drafting requirements',
    REQ_AWAITING_CLARIFICATION: 'Asked for clarification',
    REQ_AWAITING_APPROVAL: 'Requirements ready for review',
    REQ_APPROVED: 'Requirements approved',
    DESIGN_DRAFTING: 'Drafting the design',
    DESIGN_AWAITING_APPROVAL: 'Design ready for review',
    DESIGN_APPROVED: 'Design approved',
    TASKS_GENERATED: 'Broke the design into tasks',
    READY_FOR_IMPLEMENTATION: 'Ready to implement',
    IMPLEMENTING: 'Implementation started',
    DONE: 'Done',
    CHANGES_REQUESTED: 'Changes requested',
    FAILED: 'Run failed',
  };
  return map[toState] ?? toState.toLowerCase().replace(/_/g, ' ');
}

export function Thread({
  items,
  specId,
  specVersion,
  openKind,
  canAnswer,
}: {
  items: readonly ThreadItem[];
  specId: string;
  specVersion: number;
  openKind: ArtifactKind | null;
  /** True only in REQ_AWAITING_CLARIFICATION — the orchestrator refuses otherwise. */
  canAnswer: boolean;
}) {
  // Open questions submit as one round, so the form is rendered once, against the last
  // of them, rather than once per question.
  const open = items.filter(
    (item): item is Extract<ThreadItem, { type: 'question' }> =>
      item.type === 'question' && item.answer === null,
  );
  const lastOpenId = open[open.length - 1]?.id ?? null;
  return (
    <ol className="thread__list">
      {items.map((item, index) => {
        const key = `${item.type}-${String(index)}`;

        if (item.type === 'request') {
          return (
            <li className="msg msg--user" key={key}>
              <div className="msg__who">You</div>
              <div className="msg__body">
                <p className="msg__text">{item.text}</p>
                <div className="msg__tags">
                  <span className="tag">
                    {item.mode === 'brownfield' ? 'existing repo' : 'new code'}
                  </span>
                  {item.repoPath !== null && <code className="tag">{item.repoPath}</code>}
                </div>
              </div>
            </li>
          );
        }

        if (item.type === 'activity') {
          return (
            <li className={`act act--${item.actorType}`} key={key}>
              <span className="act__dot" aria-hidden="true" />
              <span className="act__text">{describe(item.toState)}</span>
              <code className="act__state">{item.toState}</code>
              <span className="act__by">{item.actorType}</span>
            </li>
          );
        }

        if (item.type === 'question') {
          return (
            <li className="msg msg--agent" key={key}>
              <div className="msg__who">Requirement Agent</div>
              <div className="msg__body">
                <p className="msg__text">{item.question}</p>
                <p className="msg__why">{item.whyItMatters}</p>

                {item.answer === null ? (
                  canAnswer && item.id === lastOpenId ? (
                    <AnswerInline
                      specId={specId}
                      specVersion={specVersion}
                      questions={open.map((q) => ({
                        id: q.id,
                        question: q.question,
                        options: q.options,
                      }))}
                    />
                  ) : canAnswer ? null : (
                    <p className="msg__why">
                      Unanswered. Answers are only accepted while the spec is awaiting
                      clarification.
                    </p>
                  )
                ) : (
                  <div className="answer">
                    <span className="answer__who">{item.answeredBy ?? 'you'}</span>
                    <p className="answer__text">{item.answer}</p>
                  </div>
                )}
              </div>
            </li>
          );
        }

        if (item.type === 'artifact') {
          const isOpen = openKind === item.kind;

          return (
            <li className="msg msg--agent" key={key}>
              <div className="msg__who">{item.createdBy}</div>
              <div className="msg__body">
                <article className={`card${isOpen ? ' is-open' : ''}`}>
                  <header className="card__head">
                    <span className="card__name mono">{KIND_LABEL[item.kind]}</span>
                    <span className="card__ver">v{item.version}</span>
                  </header>

                  {item.facts.length > 0 && <p className="card__facts">{item.facts.join(' · ')}</p>}

                  <footer className="card__foot">
                    <code className="card__hash">{item.contentHash.slice(0, 12)}</code>
                    <Link
                      className="card__open"
                      href={`/workspace/${specId}?doc=${item.kind}&v=${String(item.version)}`}
                    >
                      {isOpen ? 'Open' : 'Review'} →
                    </Link>
                  </footer>
                </article>
              </div>
            </li>
          );
        }

        if (item.type === 'task') {
          // The implementation phase, written into the conversation. Claude Code is the
          // agent here, working through the MCP server; these are the only items in the
          // thread that AgentForge itself did not produce.
          const done = item.event === 'completed';

          return (
            <li className={`work${done ? ' is-done' : ''}`} key={key}>
              <span className="work__dot" aria-hidden="true" />
              <div className="work__body">
                <span className="work__head">
                  <code className="work__key">{item.taskKey}</code>
                  <span className="work__title">{item.title}</span>
                </span>

                <span className="work__what">
                  {done ? 'completed' : 'claimed — implementation in progress'}
                  {item.verifies.length > 0 && ` · verifies ${item.verifies.join(', ')}`}
                </span>

                {item.evidence !== null && item.evidence.length > 0 && (
                  // Real completion evidence runs to hundreds of words — a Claude Code
                  // session names every file, every criterion and everything it could
                  // not verify. That is exactly what should be recorded, and exactly
                  // what should not be shouted at someone scrolling the conversation.
                  // Collapsed here, in full on demand, never truncated in the database.
                  <details className="work__eviWrap">
                    <summary className="work__eviPeek">
                      {item.evidence.length > 150
                        ? `${item.evidence.slice(0, 150).trimEnd()}…`
                        : item.evidence}
                    </summary>
                    <p className="work__evidence">{item.evidence}</p>
                  </details>
                )}
              </div>
            </li>
          );
        }

        return (
          <li className={`dec dec--${item.decision}`} key={key}>
            <span className="dec__dot" aria-hidden="true" />
            <div className="dec__body">
              <span className="dec__head">
                <strong>{item.actor}</strong> {item.decision.replace('_', ' ')}d{' '}
                {KIND_LABEL[item.artifactKind]}
              </span>
              {item.comment !== null && item.comment.length > 0 && (
                <p className="dec__comment">{item.comment}</p>
              )}
              <code className="dec__hash">bound to {item.contentHash.slice(0, 12)}</code>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
