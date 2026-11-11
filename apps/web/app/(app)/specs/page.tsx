import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@agentforge/db';
import { listSpecs, nextStates } from '@agentforge/orchestrator';
import { isAwaitingHuman, type SpecState } from '@agentforge/contract';

/**
 * The spec list.
 *
 * The one thing a reviewer opens this page to find out is *which specs are waiting on
 * me*. So that is the only state the accent is spent on: everything else — drafting,
 * approved, implementing — stays neutral, and a page of neutral rows with one orange
 * badge answers the question without being read.
 *
 * Rendered per request because spec state changes behind the UI, and a cached list that
 * says a spec is awaiting approval after it has been approved would be worse than slow.
 */

export const metadata: Metadata = {
  title: 'Specs',
};

export const dynamic = 'force-dynamic';

/** Maps a state to its badge treatment. Awaiting-human is the only highlighted case. */
function stateClass(status: SpecState): string {
  if (isAwaitingHuman(status)) return 'state state--awaiting';
  if (status === 'DONE') return 'state state--done';
  if (status === 'FAILED') return 'state state--failed';
  return 'state';
}

export default function SpecsPage() {
  const { specs, total } = listSpecs(getDb(), {
    status: null,
    mode: null,
    limit: 50,
    offset: 0,
  });

  const waiting = specs.filter((spec) => isAwaitingHuman(spec.status)).length;

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Specs</h1>
        <p className="page__lede">
          {total === 0 ? 'Nothing here yet.' : `${String(total)} spec${total === 1 ? '' : 's'}.`}{' '}
          {waiting > 0
            ? `${String(waiting)} waiting on a decision from you.`
            : 'None are waiting on a decision.'}{' '}
          The next states shown are the only moves the orchestrator would accept.
        </p>
      </div>

      {total === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No specs yet</h2>
          <p className="empty__body">
            Load the fixture data with <code>npm run db:seed</code> to see three specs at different
            points in the lifecycle, or create one to start from a feature request.
          </p>
        </div>
      ) : (
        <ol className="specs">
          {specs.map((spec) => {
            const next = nextStates(spec.status);

            return (
              <li className="specRow" key={spec.id}>
                <div className="specRow__top">
                  <h2 className="specRow__title">
                    <Link href={`/specs/${spec.id}`}>{spec.title}</Link>
                  </h2>
                  <span className={stateClass(spec.status)}>{spec.status}</span>
                  {isAwaitingHuman(spec.status) && (
                    <span className="badge badge--accent">awaiting review</span>
                  )}
                </div>

                <p className="specRow__desc">{spec.description}</p>

                <div className="specRow__meta">
                  <span>{spec.mode}</span>
                  <span>v{spec.version}</span>
                  <span>next: {next.length === 0 ? 'terminal' : next.join(', ')}</span>
                  <code>{spec.id}</code>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
