import { getDb } from '@agentforge/db';
import { listSpecs, nextStates } from '@agentforge/orchestrator';
import { isAwaitingHuman } from '@agentforge/contract';

/**
 * Spec list.
 *
 * A deliberately plain server-rendered index. The UI track owns the real screens; this
 * exists so the backend is demonstrably working end to end from day one, and so a
 * junior has a running page to build against rather than a blank project.
 */

export const dynamic = 'force-dynamic';

export default function Home() {
  const { specs, total } = listSpecs(getDb(), {
    status: null,
    mode: null,
    limit: 50,
    offset: 0,
  });

  if (total === 0) {
    return (
      <>
        <h1>Specs</h1>
        <p className="muted">
          No specs yet. Run <code>npm run db:seed</code> to load fixture data.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Specs</h1>
      <p className="muted">
        {total} spec{total === 1 ? '' : 's'}. Gates are enforced by the orchestrator, so the actions
        listed for each spec are the only ones that would be accepted.
      </p>

      {specs.map((spec) => (
        <article className="card" key={spec.id}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>{spec.title}</h2>
          <p style={{ margin: '0 0 10px' }}>
            <span className="pill">{spec.status}</span> <span className="pill">{spec.mode}</span>{' '}
            <span className="pill">v{spec.version}</span>
            {isAwaitingHuman(spec.status) ? (
              <>
                {' '}
                <span className="pill" style={{ color: 'var(--warn)' }}>
                  awaiting review
                </span>
              </>
            ) : null}
          </p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {spec.description}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            <code>{spec.id}</code> — next: {nextStates(spec.status).join(', ') || 'terminal'}
          </p>
        </article>
      ))}
    </>
  );
}
