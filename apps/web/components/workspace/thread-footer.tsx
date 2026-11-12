'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorNote } from '@/components/workspace/error-note';
import { explainError, type ErrorExplanation } from '@/components/workspace/explain-error';
import { useRouter } from 'next/navigation';
import { createClient, type SpecState } from '@agentforge/contract';
import { announce } from '@/components/workspace/announcer';
import { LiveRun } from '@/components/workspace/live-run';
import {
  describeWorking,
  isWorkingState,
  runCostUsd,
  runPhase,
} from '@/components/workspace/run-progress';
import { useNow, useRunStream } from '@/components/workspace/use-run-stream';
import type { RunActivity } from '@/lib/activity';

/**
 * The action bar.
 *
 * Offers exactly one next step, and only when the orchestrator would accept it. A bar
 * full of buttons that return 409 teaches a reviewer that the interface does not know
 * the rules, which on a governance tool is worse than offering nothing.
 *
 * When the spec is waiting on a human it offers no action at all — the decision lives in
 * the document pane, next to the bytes being approved, and duplicating it here would be
 * the "approve without reading" path this design exists to avoid.
 */

const client = createClient();

export interface Action {
  readonly label: string;
  readonly running: string;
  readonly run: (specId: string, version: number) => Promise<unknown>;
}

const idempotency = (): string => `ui-${String(Date.now())}`;

const draftRequirements: Action = {
  label: 'Draft requirements',
  running: 'Drafting…',
  run: (specId, version) =>
    client.draftRequirements(specId, {
      expected_version: version,
      idempotency_key: idempotency(),
    }),
};

const scanRepository: Action = {
  label: 'Scan the repository',
  running: 'Scanning…',
  run: (specId, version) =>
    client.scanContext(specId, {
      expected_version: version,
      strategy: 'fts_repomap',
      max_tool_calls: null,
    }),
};

/**
 * The one action available from each state, or null when the next move is not an
 * agent's.
 *
 * A total record rather than a switch: adding a state to the contract becomes a compile
 * error here, instead of a screen that silently offers nothing in a state nobody
 * remembered to handle.
 *
 * Drafting states are the agent already working. Approval states are the human's move,
 * taken in the document pane next to the bytes — deliberately not duplicated here, since
 * an approve button in the action bar is the "approve without reading" path this layout
 * exists to avoid. Terminal states have no next step.
 */
const ACTIONS: Readonly<Record<SpecState, Action | null>> = {
  CREATED: null, // depends on mode; resolved in actionFor below
  CONTEXT_READY: draftRequirements,
  REQ_AWAITING_CLARIFICATION: draftRequirements,
  REQ_APPROVED: {
    label: 'Draft the design',
    running: 'Designing…',
    run: (specId, version) =>
      client.draftDesign(specId, {
        expected_version: version,
        idempotency_key: idempotency(),
      }),
  },
  DESIGN_APPROVED: {
    label: 'Break into tasks',
    running: 'Generating…',
    run: (specId, version) =>
      client.generateTasks(specId, {
        expected_version: version,
        idempotency_key: idempotency(),
      }),
  },

  // A drafting state reached by a page load means a previous attempt did not finish —
  // these routes are synchronous, so a run in progress holds its own button in a pending
  // state rather than rendering a fresh page here. Running again is safe: an agent call
  // that fails writes no artifact and moves nothing.
  CONTEXT_SCANNING: { ...scanRepository, label: 'Run the scan again', running: 'Scanning…' },
  REQ_DRAFTING: { ...draftRequirements, label: 'Draft requirements again' },
  DESIGN_DRAFTING: {
    label: 'Draft the design again',
    running: 'Designing…',
    run: (specId, version) =>
      client.draftDesign(specId, {
        expected_version: version,
        idempotency_key: idempotency(),
      }),
  },

  REQ_AWAITING_APPROVAL: null,
  DESIGN_AWAITING_APPROVAL: null,
  TASKS_GENERATED: null,
  READY_FOR_IMPLEMENTATION: null,
  IMPLEMENTING: null,
  DONE: null,
  FAILED: null,
};

/**
 * The one step to offer, given everything that decides it.
 *
 * Exported so the decision can be tested without rendering a component that needs a
 * router. It exists as its own function because it was wrong once: with a clarification
 * question still open, the footer offered "Draft requirements" and the server refused it
 * ("1 clarification(s) are still unanswered"), which contradicts this file's own rule of
 * offering a step only when the orchestrator would accept it.
 */
export function chooseAction(
  status: SpecState,
  mode: 'greenfield' | 'brownfield',
  openQuestions: number,
): Action | null {
  // Waiting on the person, not on an agent. Answering only *records* the answers — it does
  // not redraft — so once every question is answered this button is exactly the right
  // next move, and until then it is a step the server will refuse.
  if (status === 'REQ_AWAITING_CLARIFICATION' && openQuestions > 0) return null;

  return actionFor(status, mode);
}

function actionFor(status: SpecState, mode: 'greenfield' | 'brownfield'): Action | null {
  // A new spec either scans a repository first or goes straight to requirements, which
  // is the one place the mode changes what happens next.
  if (status === 'CREATED') return mode === 'brownfield' ? scanRepository : draftRequirements;
  return ACTIONS[status];
}

/** What the bar says when there is nothing to press. */
function restingNote(status: SpecState): string {
  if (status === 'TASKS_GENERATED') {
    return 'Open the tasks to release them for implementation. File edits stay blocked until you do.';
  }
  if (status === 'REQ_AWAITING_APPROVAL' || status === 'DESIGN_AWAITING_APPROVAL') {
    return 'Open the document to approve, request changes, or reject.';
  }
  if (status === 'READY_FOR_IMPLEMENTATION' || status === 'IMPLEMENTING') {
    return 'Released. Claude Code can now claim tasks through the MCP server, and the PreToolUse hook permits edits.';
  }
  if (status === 'DONE') return 'This spec is complete.';
  if (status === 'FAILED') return 'This run failed. Check the thread for the last step.';
  return 'Implementation is driven from Claude Code through the MCP server.';
}

export function ThreadFooter({
  specId,
  status,
  specVersion,
  mode,
  activity,
  openQuestions,
}: {
  specId: string;
  status: SpecState;
  specVersion: number;
  mode: 'greenfield' | 'brownfield';
  activity: RunActivity;
  /** Clarification questions still waiting on an answer. */
  openQuestions: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorExplanation | null>(null);
  // When *this tab* started the run, in browser time. Distinct from the server's record of
  // when the spec entered the state, because this tab knows a run began before the server
  // state the page was rendered from has caught up.
  const clickedAt = useRef<number | null>(null);

  // Waiting on the person, not on an agent. The footer used to offer "Draft requirements"
  // here regardless, and the server refused it with "1 clarification(s) are still
  // unanswered" — against this component's own stated rule of offering a step only when
  // the orchestrator would accept it. Answering only *records* the answers; it does not
  // redraft, so once every question is answered the button is exactly the right next move.
  const blockedOnAnswers = status === 'REQ_AWAITING_CLARIFICATION' && openQuestions > 0;

  const action = chooseAction(status, mode, openQuestions);

  // Following a run is for as long as one is going: the one this tab started, or one the
  // spec is already in the middle of — which is what a reload or a second tab lands on.
  const streaming = pending || isWorkingState(status);
  const { view, connection } = useRunStream(specId, streaming);
  const now = useNow(streaming);

  // The browser's clock is not the server's. Timestamps from the server are shifted by the
  // difference measured when this page was rendered, so a laptop that is five minutes fast
  // does not declare every run quiet on arrival.
  const [skew] = useState(() => Date.parse(activity.serverNow) - Date.now());
  const toBrowserTime = (iso: string | null): number | null =>
    iso === null ? null : Date.parse(iso) - skew;

  const lastActivityAt = Math.max(
    view.lastActivityAt ?? 0,
    toBrowserTime(activity.enteredAt) ?? 0,
    toBrowserTime(activity.lastCallAt) ?? 0,
    clickedAt.current ?? 0,
  );
  const phase = runPhase(now, lastActivityAt === 0 ? null : lastActivityAt);

  // Anchored to the click for the *whole* run, not just while the request is pending. It
  // used to switch to the server's state-entry time the moment the request resolved —
  // a few seconds later than the click — so the timer visibly jumped backwards at the end.
  const startedAt = clickedAt.current ?? toBrowserTime(activity.enteredAt) ?? now;

  // Forget the click once nothing is running, so the next run on a reloaded page measures
  // from the server's record instead of from a click this tab made long ago.
  useEffect(() => {
    if (!streaming) clickedAt.current = null;
  }, [streaming]);

  const workingLabel =
    view.state !== null && isWorkingState(view.state)
      ? describeWorking(view.state)
      : isWorkingState(status)
        ? describeWorking(status)
        : (action?.running ?? 'Working');

  async function run(): Promise<void> {
    if (action === null) return;

    setError(null);
    clickedAt.current = Date.now();
    setPending(true);
    announce(`${action.running} This can take a minute or two.`);

    try {
      await action.run(specId, specVersion);
      router.refresh();
    } catch (caught) {
      setError(explainError(caught, 'That step could not be run.'));
    } finally {
      setPending(false);
    }
  }

  // The button is offered when nothing is running, or when a run has gone quiet for long
  // enough that running it again is a reasonable thing to consider. While one is plainly
  // alive it is not offered at all: the old footer said "a previous attempt did not
  // finish, so running again is safe" about runs that were still going, which invites a
  // second paid run on top of the first.
  const showButton = action !== null && (!streaming || (phase === 'quiet' && !pending));

  return (
    <footer className="tfoot">
      {streaming && (
        <LiveRun
          label={workingLabel}
          elapsedMs={now - startedAt}
          costUsd={runCostUsd(view)}
          phase={phase}
          connection={connection}
          onCheck={() => {
            router.refresh();
          }}
        />
      )}

      {action === null && !streaming && (
        <p className="tfoot__note">
          {blockedOnAnswers
            ? `Answer ${openQuestions === 1 ? 'the question' : `the ${String(openQuestions)} questions`} above to continue.`
            : restingNote(status)}
        </p>
      )}

      {showButton && (
        <div className="tfoot__actions">
          {/* Never rendered while a run is in flight — the click replaces it with the live
              indicator — so it needs no disabled or "running" state of its own. */}
          <button
            className="tfoot__go"
            type="button"
            onClick={() => {
              void run();
            }}
          >
            {action.label}
          </button>
          {!streaming && (
            <span className="tfoot__note">
              Runs the agent and writes its proposal. You decide afterwards.
            </span>
          )}
        </div>
      )}

      {error !== null && (
        <ErrorNote
          className="tfoot__error"
          error={error}
          onRetry={() => {
            void run();
          }}
        />
      )}
    </footer>
  );
}
