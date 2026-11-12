import { StreamEventSchema, type SpecState, type StreamEvent } from '@agentforge/contract';

/**
 * What a run in progress looks like from the browser.
 *
 * Everything here is pure, because the interesting questions are all logic rather than
 * rendering: when has a run *finished*, when has it merely gone *quiet*, and what counts
 * as activity. Those are the questions the old behaviour got wrong, and they are
 * worth being able to test without a browser or an EventSource.
 *
 * The old behaviour was a disabled button and "this can take up to a minute". It gave no
 * sign of life, and — worse — it treated a spec that was *still working* identically to
 * one whose run had died. Reload the page mid-run and the footer said "a previous attempt
 * did not finish, so running again is safe", inviting a second paid run on top of the
 * first. The route is synchronous, so a reloaded page has no idea its own run is still
 * going; the stream is how it finds out.
 */

/** The states in which one of AgentForge's own agents is the thing working. */
export const WORKING_STATES: ReadonlySet<SpecState> = new Set<SpecState>([
  'CONTEXT_SCANNING',
  'REQ_DRAFTING',
  'DESIGN_DRAFTING',
]);

export function isWorkingState(state: SpecState): boolean {
  return WORKING_STATES.has(state);
}

/** What the agent is doing, as a present-tense phrase. */
export function describeWorking(state: SpecState): string {
  if (state === 'CONTEXT_SCANNING') return 'Scanning the repository';
  if (state === 'REQ_DRAFTING') return 'Drafting requirements';
  if (state === 'DESIGN_DRAFTING') return 'Drafting the design';
  return 'Working';
}

/**
 * How long without any sign of life before the run is called quiet.
 *
 * Generous on purpose, and this is the part that is easy to get wrong. Spend is recorded
 * when a model call *completes*, so while one long call is in flight — a design on a large
 * model can run for minutes — nothing at all changes in the database. A short threshold
 * would announce "this run seems to have died" about a run that is working normally, and
 * invite exactly the duplicate paid run this exists to prevent.
 */
export const QUIET_AFTER_MS = 4 * 60 * 1000;

/** "7s", "1m 12s", "12m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${String(total)}s`;

  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
}

export type RunPhase = 'active' | 'quiet';

/**
 * Active until nothing has happened for `QUIET_AFTER_MS`.
 *
 * Quiet is an *inference*, not a fact — nothing in the database records that a run is
 * alive — and the interface says so rather than announcing a death.
 */
export function runPhase(now: number, lastActivityAt: number | null): RunPhase {
  if (lastActivityAt === null) return 'active';
  return now - lastActivityAt > QUIET_AFTER_MS ? 'quiet' : 'active';
}

/** What has been observed on the stream so far. */
export interface RunView {
  /** The first state seen: the baseline every later change is compared against. */
  readonly baselineState: SpecState | null;
  readonly state: SpecState | null;
  readonly baselineCostUsd: number | null;
  readonly costUsd: number | null;
  /** Browser clock, ms. Null until something has been observed. */
  readonly lastActivityAt: number | null;
  readonly settled: boolean;
}

export const EMPTY_RUN: RunView = {
  baselineState: null,
  state: null,
  baselineCostUsd: null,
  costUsd: null,
  lastActivityAt: null,
  settled: false,
};

/** Spend attributable to this run: current total minus what it was when we started watching. */
export function runCostUsd(view: RunView): number | null {
  if (view.costUsd === null || view.baselineCostUsd === null) return null;
  // Floating point: 0.1 + 0.2 style drift would otherwise show as $0.00000000001.
  return Math.max(0, Math.round((view.costUsd - view.baselineCostUsd) * 1e6) / 1e6);
}

/**
 * Folds one stream event into the view.
 *
 * `refresh` says the page's server-rendered content is now out of date, which is the only
 * thing the caller needs to act on. The *first* state and cost events are a baseline, not
 * news: the stream opens by reporting where things already are, and refreshing on that
 * would re-render the page the user is already looking at.
 */
export function applyEvent(
  prev: RunView,
  event: StreamEvent,
  now: number,
): { readonly next: RunView; readonly refresh: boolean } {
  switch (event.type) {
    case 'state': {
      if (prev.baselineState === null) {
        return {
          next: { ...prev, baselineState: event.state, state: event.state },
          refresh: false,
        };
      }

      if (event.state === prev.state) return { next: prev, refresh: false };

      return {
        next: { ...prev, state: event.state, lastActivityAt: now },
        refresh: true,
      };
    }

    case 'cost': {
      if (prev.baselineCostUsd === null) {
        return {
          next: { ...prev, baselineCostUsd: event.cost_usd, costUsd: event.cost_usd },
          refresh: false,
        };
      }

      if (event.cost_usd === prev.costUsd) return { next: prev, refresh: false };

      // A model call finished: the strongest sign of life this stream can give.
      return { next: { ...prev, costUsd: event.cost_usd, lastActivityAt: now }, refresh: false };
    }

    case 'done':
      return { next: { ...prev, settled: true }, refresh: true };

    // Declared by the contract and handled so a future emitter cannot break the page, but
    // nothing emits them today: the route is database-polled and has no token stream. No
    // interface is built on events that never arrive.
    case 'token':
    case 'tool_call':
    case 'error':
      return { next: prev, refresh: false };
  }
}

/**
 * Parses one `data:` payload from the stream, or reports why it could not.
 *
 * Validated against the same schema the server serialises with, as every other boundary
 * in this codebase is. A malformed event is reported to the caller rather than skipped:
 * an interface quietly ignoring part of a stream is one whose "live" indicator can be
 * wrong without anyone being able to say why.
 */
export function parseStreamData(
  data: string,
):
  | { readonly ok: true; readonly event: StreamEvent }
  | { readonly ok: false; readonly reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { ok: false, reason: 'the stream sent something that was not JSON' };
  }

  const parsed = StreamEventSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'the stream sent an event the client does not know' };
  }

  return { ok: true, event: parsed.data };
}
