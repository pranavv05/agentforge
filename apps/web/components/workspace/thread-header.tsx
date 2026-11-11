import type { SpecMode, SpecState } from '@agentforge/contract';

/**
 * The thread header.
 *
 * Carries the three numbers that are actually true and actually measured: spend, call
 * count, and the unverified-claim rate when a scan has run. They sit here rather than on
 * a separate page because they change while you watch, and because a tool that argues
 * for measurement should put its own measurements where they are visible.
 */
export function ThreadHeader({
  title,
  status,
  mode,
  awaiting,
  costUsd,
  calls,
  unverifiedRate,
}: {
  title: string;
  status: SpecState;
  mode: SpecMode;
  awaiting: boolean;
  costUsd: number;
  calls: number;
  unverifiedRate: number | null;
}) {
  return (
    <header className="thead">
      <div className="thead__main">
        <h1 className="thead__title">{title}</h1>
        <span className={`chip${awaiting ? ' chip--warn' : ''}`}>{status}</span>
        <span className="chip chip--quiet">{mode}</span>
      </div>

      <dl className="thead__stats">
        <div>
          <dt>spend</dt>
          <dd className="tabular">${costUsd.toFixed(4)}</dd>
        </div>
        <div>
          <dt>calls</dt>
          <dd className="tabular">{calls}</dd>
        </div>
        {unverifiedRate !== null && (
          <div>
            <dt>unverified</dt>
            <dd className="tabular">{(unverifiedRate * 100).toFixed(1)}%</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
