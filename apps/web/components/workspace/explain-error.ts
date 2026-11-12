import { AgentForgeError, type ErrorCode } from '@agentforge/contract';

/**
 * What an error means to the person who just hit it.
 *
 * Four components used to translate failures their own way, and mostly did not: three
 * fell back to the raw server message ("expected version 7, found 8"), none recognised
 * an expired session, a spend-limit refusal or the network being down, and "Reload to
 * see where it got to" gave no way to reload. A failure is the moment a person most
 * needs to know three things — what happened, whether anything changed, and what to do
 * next — so that answer is written once, here, and branches on the error *code* rather
 * than on message text, which is not a contract.
 *
 * Every message that follows a refused action says whether anything changed. In this
 * product that is not a courtesy: the audit log is append-only, so "did my click record
 * something?" is a real question with a real answer.
 */

/** What the person can do about it, when there is something. */
export type ErrorAction = 'reload' | 'sign-in' | 'retry' | null;

export interface ErrorExplanation {
  readonly message: string;
  readonly action: ErrorAction;
  /** The correlation id, so a failure can be found in the logs and in `llm_calls`. */
  readonly reference: string | null;
}

const BY_CODE: Readonly<
  Partial<Record<ErrorCode, { readonly message: string; readonly action: ErrorAction }>>
> = {
  UNAUTHENTICATED: {
    message: 'Your session has ended. Sign in again to continue. This attempt changed nothing.',
    action: 'sign-in',
  },
  VERSION_CONFLICT: {
    message:
      'This spec moved while the page was open, so the action was refused and nothing ' +
      'changed. Reload to see where it got to.',
    action: 'reload',
  },
  HASH_MISMATCH: {
    message:
      'This document changed after you opened it, so the decision was refused and nothing ' +
      'moved. Reload and read the current version before deciding.',
    action: 'reload',
  },
  BUDGET_EXCEEDED: {
    message:
      'This run reached its spend limit and was stopped before the model was called, so ' +
      'nothing was charged. Raise SDD_RUN_COST_CAP_USD to continue.',
    action: null,
  },
  BUDGET_LIMIT_REACHED: {
    message:
      'The agent used up its allowance for this step (tool calls, tokens or time) and ' +
      'stopped. Narrow the request, or raise the limits.',
    action: null,
  },
  UPSTREAM_FAILED: {
    message:
      'The model provider failed after several retries. Nothing was recorded. Try again ' +
      'in a moment.',
    action: 'retry',
  },
  NOT_FOUND: {
    message: 'That spec or document no longer exists.',
    action: 'reload',
  },
  INTERNAL: {
    message: 'Something went wrong on our side, and nothing was changed.',
    action: 'retry',
  },
};

/** Codes whose server message is already written for a person, so it is shown as is. */
const SERVER_MESSAGE_IS_FIT_TO_SHOW: ReadonlySet<ErrorCode> = new Set([
  'VALIDATION_FAILED',
  'GROUNDING_FAILED',
  'COMPLIANCE_VIOLATION',
  'PATH_ESCAPES_ROOT',
]);

export function explainError(caught: unknown, fallback: string): ErrorExplanation {
  if (caught instanceof AgentForgeError) {
    const known = BY_CODE[caught.code];
    const reference = caught.correlationId;

    if (known !== undefined) return { ...known, reference };

    if (caught.code === 'VALIDATION_FAILED') {
      // The orchestrator reports a bad repository in the vocabulary of the field it
      // checked ("repo_path does not exist: ..."). Someone who chose "Existing repo" and
      // typed a folder never saw a field called repo_path, so say it in their terms —
      // keeping the path itself, which is the only actionable part.
      const missing = /^repo_path does not exist: (.+)$/s.exec(caught.message);
      if (missing?.[1] !== undefined) {
        return {
          message: `That repository path does not exist: ${missing[1]}. Point it at a checkout on this machine.`,
          action: null,
          reference,
        };
      }

      const notDirectory = /^repo_path is not a directory: (.+)$/s.exec(caught.message);
      if (notDirectory?.[1] !== undefined) {
        return {
          message: `That path is a file, not a folder: ${notDirectory[1]}. Point it at the repository's root directory.`,
          action: null,
          reference,
        };
      }

      if (caught.message === 'brownfield specs require a repo_path') {
        return {
          message: 'Existing-repo mode needs a repository path. Add one, or switch to New code.',
          action: null,
          reference,
        };
      }
    }

    if (SERVER_MESSAGE_IS_FIT_TO_SHOW.has(caught.code)) {
      return { message: caught.message, action: null, reference };
    }

    if (caught.code === 'ILLEGAL_TRANSITION' || caught.code === 'PRECONDITION_FAILED') {
      // The server's sentence says *why* ("no design artifact exists for this spec yet"),
      // which is the useful part, so it is kept and framed rather than replaced.
      return {
        message: `That step is not available right now. ${caught.message}`,
        action: 'reload',
        reference,
      };
    }

    return { message: fallback, action: null, reference };
  }

  // `fetch` rejects with a bare TypeError when the request never completes — offline, DNS,
  // the dev server restarting. It never becomes an AgentForgeError, which is why this
  // used to read as a vague "could not be run" that hid the actual cause.
  if (caught instanceof TypeError) {
    return {
      message:
        'Could not reach the server. Check your connection, then try again. Nothing was ' +
        'changed.',
      action: 'retry',
      reference: null,
    };
  }

  return { message: fallback, action: null, reference: null };
}
