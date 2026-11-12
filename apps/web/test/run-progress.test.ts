import { describe, expect, it } from 'vitest';
import { SPEC_STATES, type StreamEvent } from '@agentforge/contract';
import {
  EMPTY_RUN,
  QUIET_AFTER_MS,
  WORKING_STATES,
  applyEvent,
  describeWorking,
  formatElapsed,
  isWorkingState,
  parseStreamData,
  runCostUsd,
  runPhase,
  type RunView,
} from '@/components/workspace/run-progress';
import { isAwaitingHuman, isTerminalState } from '@agentforge/contract';
import { chooseAction } from '@/components/workspace/thread-footer';

/**
 * Following a run.
 *
 * The old behaviour was a disabled button and "this can take up to a minute". It had no
 * sign of life, and it could not tell a run that was working from one that had stopped:
 * reload mid-run and the footer said "a previous attempt did not finish, so running again
 * is safe" about a run that was still going, inviting a second paid run on top of the
 * first. The questions that decide that — what counts as activity, when is a run merely
 * quiet — are pure logic, so they are tested without a browser or an EventSource.
 */

const state = (s: (typeof SPEC_STATES)[number]): StreamEvent => ({ type: 'state', state: s });
const cost = (n: number): StreamEvent => ({ type: 'cost', cost_usd: n });

/** Folds a list of events, collecting whether any of them asked for a refresh. */
function fold(events: readonly StreamEvent[], start = 1_000) {
  let view: RunView = EMPTY_RUN;
  const refreshes: boolean[] = [];
  events.forEach((event, i) => {
    const out = applyEvent(view, event, start + i * 1_000);
    view = out.next;
    refreshes.push(out.refresh);
  });
  return { view, refreshes };
}

describe('which states count as a run in progress', () => {
  it('are the three where one of our own agents is working', () => {
    expect([...WORKING_STATES].sort()).toEqual([
      'CONTEXT_SCANNING',
      'DESIGN_DRAFTING',
      'REQ_DRAFTING',
    ]);
  });

  it('never include a state that is waiting on a human', () => {
    // The point of the distinction: a spec at a gate is waiting on a person, not working,
    // and a "run in progress" indicator on it would be a lie.
    for (const s of SPEC_STATES) {
      if (isWorkingState(s)) {
        expect(isAwaitingHuman(s), s).toBe(false);
        expect(isTerminalState(s), s).toBe(false);
      }
    }
  });

  it('describe each working state in the present tense', () => {
    for (const s of WORKING_STATES) expect(describeWorking(s)).toMatch(/ing /);
  });
});

describe('applying stream events', () => {
  it('treats the first state and cost as a baseline, not as news', () => {
    // The stream opens by reporting where things already are. Refreshing on that would
    // re-render the page the user is already looking at, on every connection.
    const { refreshes, view } = fold([state('REQ_DRAFTING'), cost(0.5)]);

    expect(refreshes).toEqual([false, false]);
    expect(view.baselineState).toBe('REQ_DRAFTING');
    expect(view.baselineCostUsd).toBe(0.5);
    expect(view.lastActivityAt).toBeNull();
  });

  it('asks for a refresh when the state genuinely changes', () => {
    const { refreshes, view } = fold([state('REQ_DRAFTING'), state('REQ_AWAITING_APPROVAL')]);

    expect(refreshes).toEqual([false, true]);
    expect(view.state).toBe('REQ_AWAITING_APPROVAL');
  });

  it('does not refresh for a state it has already seen', () => {
    const { refreshes } = fold([state('REQ_DRAFTING'), state('REQ_DRAFTING')]);

    expect(refreshes).toEqual([false, false]);
  });

  it('counts a changed cost as activity — a model call finished — without a refresh', () => {
    const { view, refreshes } = fold([state('REQ_DRAFTING'), cost(1), cost(1.004)]);

    expect(view.lastActivityAt).not.toBeNull();
    // Spend moving is not a reason to re-render the thread; only a state change is.
    expect(refreshes.every((r) => !r)).toBe(true);
  });

  it('does not count a repeated cost as activity', () => {
    const { view } = fold([state('REQ_DRAFTING'), cost(1), cost(1)]);

    // Otherwise a heartbeat-style repeat would keep a dead run looking alive forever.
    expect(view.lastActivityAt).toBeNull();
  });

  it('settles and refreshes on done', () => {
    const { view, refreshes } = fold([state('REQ_DRAFTING'), { type: 'done', artifact_id: null }]);

    expect(view.settled).toBe(true);
    expect(refreshes.at(-1)).toBe(true);
  });

  it('ignores events nothing emits yet, without breaking', () => {
    // `token` and `tool_call` are in the contract but the route is database-polled and
    // never sends them. They are handled so a future emitter cannot break the page, and no
    // interface is built on them.
    const out = applyEvent(EMPTY_RUN, { type: 'tool_call', name: 'read', index: 3, budget: 25 }, 1);

    expect(out.refresh).toBe(false);
    expect(out.next).toEqual(EMPTY_RUN);
  });
});

describe('spend attributable to a run', () => {
  it('is the total now minus the total when watching began', () => {
    const { view } = fold([state('REQ_DRAFTING'), cost(1.25), cost(1.2541)]);

    expect(runCostUsd(view)).toBe(0.0041);
  });

  it('is unknown until both readings exist, and never negative', () => {
    expect(runCostUsd(EMPTY_RUN)).toBeNull();
    expect(runCostUsd({ ...EMPTY_RUN, baselineCostUsd: 2, costUsd: 1 })).toBe(0);
  });

  it('does not show floating point drift', () => {
    const view: RunView = { ...EMPTY_RUN, baselineCostUsd: 0.1, costUsd: 0.1 + 0.2 };

    // 0.30000000000000004 - 0.1 would render as $0.20000000000000004.
    expect(runCostUsd(view)).toBe(0.2);
  });
});

describe('when a run is merely quiet', () => {
  it('is active with no activity recorded at all', () => {
    expect(runPhase(5_000, null)).toBe('active');
  });

  it('stays active well past a minute, because one model call can take minutes', () => {
    // Spend is recorded when a call *completes*, so a single long call produces no
    // signal at all. A short threshold would announce a healthy run as dead and invite
    // exactly the duplicate paid run this exists to prevent.
    expect(runPhase(3 * 60_000, 0)).toBe('active');
    expect(runPhase(QUIET_AFTER_MS - 1, 0)).toBe('active');
    expect(runPhase(QUIET_AFTER_MS, 0)).toBe('active');
  });

  it('turns quiet only after the threshold', () => {
    expect(runPhase(QUIET_AFTER_MS + 1, 0)).toBe('quiet');
  });

  it('measures from the most recent activity, not from the start', () => {
    expect(runPhase(QUIET_AFTER_MS + 10_000, 20_000)).toBe('active');
  });

  it('has a threshold generous enough to be safe', () => {
    expect(QUIET_AFTER_MS).toBeGreaterThanOrEqual(3 * 60_000);
  });
});

describe('formatting elapsed time', () => {
  it.each([
    [0, '0s'],
    [7_000, '7s'],
    [59_999, '59s'],
    [60_000, '1m'],
    [72_000, '1m 12s'],
    [12 * 60_000, '12m'],
    [-500, '0s'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe('parsing the stream', () => {
  it('accepts a valid event', () => {
    const out = parseStreamData(JSON.stringify({ type: 'state', state: 'REQ_DRAFTING' }));

    expect(out.ok).toBe(true);
  });

  it('reports malformed data rather than skipping it', () => {
    // An interface that silently ignores part of its stream can show a "live" indicator
    // that is wrong with no way to say why.
    const out = parseStreamData('not json {');

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('not JSON');
  });

  it('reports an event the contract does not define', () => {
    const out = parseStreamData(JSON.stringify({ type: 'surprise', anything: 1 }));

    expect(out.ok).toBe(false);
  });

  it('rejects an unknown state rather than trusting the server', () => {
    const out = parseStreamData(JSON.stringify({ type: 'state', state: 'MADE_UP' }));

    expect(out.ok).toBe(false);
  });
});

describe('what the footer offers', () => {
  it('offers nothing while a clarification question is still open', () => {
    // It used to offer "Draft requirements" here and the server refused it with
    // "1 clarification(s) are still unanswered".
    expect(chooseAction('REQ_AWAITING_CLARIFICATION', 'greenfield', 1)).toBeNull();
    expect(chooseAction('REQ_AWAITING_CLARIFICATION', 'greenfield', 3)).toBeNull();
  });

  it('offers to continue once every question is answered', () => {
    // Answering only records the answers; it does not redraft. So after the last one, the
    // button is exactly the right next move.
    expect(chooseAction('REQ_AWAITING_CLARIFICATION', 'greenfield', 0)?.label).toBe(
      'Draft requirements',
    );
  });

  it('offers a first step from a new spec, which depends on mode', () => {
    expect(chooseAction('CREATED', 'greenfield', 0)?.label).toBe('Draft requirements');
    expect(chooseAction('CREATED', 'brownfield', 0)?.label).toBe('Scan the repository');
  });

  it("offers nothing at a human gate, where the move is the reviewer's", () => {
    for (const s of [
      'REQ_AWAITING_APPROVAL',
      'DESIGN_AWAITING_APPROVAL',
      'TASKS_GENERATED',
    ] as const) {
      expect(chooseAction(s, 'greenfield', 0), s).toBeNull();
    }
  });

  it('offers a re-run only from a working state, where it is a recovery', () => {
    for (const s of WORKING_STATES) {
      expect(chooseAction(s, 'greenfield', 0)?.label, s).toMatch(/again/i);
    }
  });
});
