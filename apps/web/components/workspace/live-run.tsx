'use client';

import { formatElapsed, type RunPhase } from '@/components/workspace/run-progress';
import type { Connection } from '@/components/workspace/use-run-stream';

/**
 * A run in progress, showing that it is.
 *
 * Before this the only sign of an agent working was a disabled button and the words "this
 * can take up to a minute". There was no elapsed time, no spend, and no way to tell a
 * run that was working from one that had stopped — so a slow call looked exactly like a
 * hang, and a hung one looked exactly like a slow call.
 *
 * Spend moves in steps, not smoothly, because it is recorded when each model call
 * *completes*. The note says so, because a cost figure that sits still for a minute and
 * then jumps reads as a bug to anyone who has not been told why.
 *
 * Screen readers are not given the ticking timer: a live region that changes every second
 * is a stream of interruptions. What they get — the state, and every change of it — goes
 * through the shared announcer instead.
 */
export function LiveRun({
  label,
  elapsedMs,
  costUsd,
  phase,
  connection,
  onCheck,
}: {
  label: string;
  elapsedMs: number;
  costUsd: number | null;
  phase: RunPhase;
  connection: Connection;
  onCheck: () => void;
}) {
  return (
    <div className={`live${phase === 'quiet' ? ' is-quiet' : ''}`}>
      <span className="live__dot" aria-hidden="true" />

      <div className="live__body">
        <p className="live__row">
          <span className="live__what">{label}</span>
          <span className="live__meta" aria-hidden="true">
            {formatElapsed(elapsedMs)}
            {costUsd !== null && ` · $${costUsd.toFixed(4)} this run`}
          </span>
        </p>

        {phase === 'quiet' ? (
          <p className="live__note">
            No activity recorded for a while. A single model call can take minutes, so this may be
            working — but it may also have been interrupted. If you run it again, any calls that
            already finished were billed, though nothing was written to the spec.
          </p>
        ) : connection === 'lost' ? (
          <p className="live__note">
            Live updates have paused. The run may still be working.{' '}
            <button className="live__link" type="button" onClick={onCheck}>
              Check now
            </button>
          </p>
        ) : (
          <p className="live__note">
            Spend is recorded as each model call finishes, so it moves in steps.
          </p>
        )}
      </div>
    </div>
  );
}
