'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentForgeError, createClient, type SpecState } from '@agentforge/contract';

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

interface Action {
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
  if (status.endsWith('_DRAFTING') || status === 'CONTEXT_SCANNING') {
    return 'A previous attempt did not finish. Nothing was written, so running again is safe.';
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
}: {
  specId: string;
  status: SpecState;
  specVersion: number;
  mode: 'greenfield' | 'brownfield';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = actionFor(status, mode);

  async function run(): Promise<void> {
    if (action === null) return;

    setError(null);
    setPending(true);

    try {
      await action.run(specId, specVersion);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof AgentForgeError
          ? caught.code === 'VERSION_CONFLICT'
            ? 'This spec moved while the page was open. Reload to see where it got to.'
            : caught.message
          : 'That step could not be run.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <footer className="tfoot">
      {action === null ? (
        <p className="tfoot__note">{restingNote(status)}</p>
      ) : (
        <>
          <button
            className="tfoot__go"
            type="button"
            disabled={pending}
            onClick={() => {
              void run();
            }}
          >
            {pending ? action.running : action.label}
          </button>
          <span className="tfoot__note">
            {pending
              ? 'This can take up to a minute.'
              : 'Runs the agent and writes its proposal. You decide afterwards.'}
          </span>
        </>
      )}

      {error !== null && (
        <p className="tfoot__error" role="alert">
          {error}
        </p>
      )}
    </footer>
  );
}
