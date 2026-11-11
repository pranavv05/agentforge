import {
  type ActorType,
  type SpecState,
  SPEC_STATES,
  type ArtifactKind,
} from '@agentforge/contract';

/**
 * The transition table.
 *
 * This is the governance differentiator in one file. In Spec Kit, OpenSpec, BMAD and
 * Spec Workflow MCP, stage gates are conventions that a model or a human is trusted to
 * follow. Here a stage change is a row-level operation that either satisfies this table
 * or fails — there is no path through the system that bypasses it.
 *
 * Three things are declared per edge:
 *
 * - `allowedActors` — who may cause it. Note that no approval edge admits `agent`:
 *   an agent can propose an artifact but can never approve one, so the audit log can
 *   be used to prove no agent ever signed off its own output.
 * - `guard` — a named precondition checked against the database inside the same
 *   transaction as the write. Guards are declarative here and implemented in
 *   `guards.ts`, so the table stays readable.
 * - `bumpsVersion` — every edge bumps the optimistic-lock counter; the field exists so
 *   the intent is explicit rather than implied by the implementation.
 */

/** Named preconditions, resolved to implementations in `guards.ts`. */
export const GUARDS = [
  /** The spec's mode must be brownfield (it has a repo to scan). */
  'mode_is_brownfield',
  /** The spec's mode must be greenfield (nothing to scan). */
  'mode_is_greenfield',
  /** A `context` artifact version must exist. */
  'context_artifact_exists',
  /** A `requirements` artifact version must exist. */
  'requirements_artifact_exists',
  /** A `design` artifact version must exist. */
  'design_artifact_exists',
  /** A `tasks` artifact version must exist. */
  'tasks_artifact_exists',
  /**
   * The latest `requirements` version must carry an `approve` decision bound to its
   * current content hash.
   *
   * This is the invariant that makes approval mean something: editing requirements
   * after approval produces a new version with a new hash, and the stale approval no
   * longer matches, so design drafting refuses to start.
   */
  'requirements_approved_and_unchanged',
  /** The same check for `design`, before tasks may be generated. */
  'design_approved_and_unchanged',
  /** All open clarifications for the current round must be answered. */
  'clarifications_answered',
] as const;

export type GuardName = (typeof GUARDS)[number];

export interface TransitionRule {
  readonly from: SpecState;
  readonly to: SpecState;
  readonly allowedActors: readonly ActorType[];
  readonly guards: readonly GuardName[];
  /** Human-readable intent, surfaced in audit entries and error messages. */
  readonly description: string;
}

const HUMAN_ONLY: readonly ActorType[] = ['human'];
const AUTOMATED: readonly ActorType[] = ['orchestrator', 'system'];
const HUMAN_OR_AUTOMATED: readonly ActorType[] = ['human', 'orchestrator', 'system'];

/**
 * Every legal edge. Anything not listed here is illegal, including self-edges.
 *
 * `FAILED` is reachable from every non-terminal state so an unrecoverable run can be
 * parked without inventing an escape hatch, and it is terminal: a failed spec is
 * re-driven by creating a new one, never by resurrecting the old row.
 */
const EDGES: readonly TransitionRule[] = [
  // --- intake -------------------------------------------------------------
  {
    from: 'CREATED',
    to: 'CONTEXT_SCANNING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['mode_is_brownfield'],
    description: 'Start the Context Agent on an existing repository.',
  },
  {
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['mode_is_greenfield'],
    description: 'Greenfield specs have no codebase to scan, so drafting starts immediately.',
  },

  // --- context ------------------------------------------------------------
  {
    from: 'CONTEXT_SCANNING',
    to: 'CONTEXT_READY',
    allowedActors: AUTOMATED,
    guards: ['context_artifact_exists'],
    description: 'A verified context bundle has been persisted.',
  },
  {
    from: 'CONTEXT_READY',
    to: 'CONTEXT_SCANNING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['mode_is_brownfield'],
    description: 'Re-scan, e.g. to compare retrieval strategies during an ablation.',
  },
  {
    from: 'CONTEXT_READY',
    to: 'REQ_DRAFTING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['context_artifact_exists'],
    description: 'Hand the verified context bundle to the Requirement Agent.',
  },

  // --- requirements -------------------------------------------------------
  {
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_CLARIFICATION',
    allowedActors: AUTOMATED,
    guards: [],
    description: 'The Requirement Agent needs answers before it can propose requirements.',
  },
  {
    from: 'REQ_AWAITING_CLARIFICATION',
    to: 'REQ_DRAFTING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['clarifications_answered'],
    description: 'Clarifications answered; redraft.',
  },
  {
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    allowedActors: AUTOMATED,
    guards: ['requirements_artifact_exists'],
    description: 'Requirements proposed and awaiting human review.',
  },
  {
    from: 'REQ_AWAITING_APPROVAL',
    to: 'REQ_APPROVED',
    allowedActors: HUMAN_ONLY,
    guards: ['requirements_approved_and_unchanged'],
    description: 'A human approved the exact requirements content they reviewed.',
  },
  {
    from: 'REQ_AWAITING_APPROVAL',
    to: 'REQ_DRAFTING',
    allowedActors: HUMAN_ONLY,
    guards: [],
    description: 'Changes requested or rejected; back to drafting.',
  },

  // --- design -------------------------------------------------------------
  {
    from: 'REQ_APPROVED',
    to: 'DESIGN_DRAFTING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: ['requirements_approved_and_unchanged'],
    description: 'Design drafting may only begin on requirements that are still approved.',
  },
  {
    from: 'DESIGN_DRAFTING',
    to: 'DESIGN_AWAITING_APPROVAL',
    allowedActors: AUTOMATED,
    guards: ['design_artifact_exists'],
    description: 'Design proposed and awaiting human review.',
  },
  {
    from: 'DESIGN_AWAITING_APPROVAL',
    to: 'DESIGN_APPROVED',
    allowedActors: HUMAN_ONLY,
    guards: ['design_approved_and_unchanged'],
    description: 'A human approved the exact design content they reviewed.',
  },
  {
    from: 'DESIGN_AWAITING_APPROVAL',
    to: 'DESIGN_DRAFTING',
    allowedActors: HUMAN_ONLY,
    guards: [],
    description: 'Changes requested or rejected; back to drafting.',
  },

  // --- tasks and implementation ------------------------------------------
  {
    from: 'DESIGN_APPROVED',
    to: 'TASKS_GENERATED',
    allowedActors: AUTOMATED,
    guards: ['design_approved_and_unchanged', 'tasks_artifact_exists'],
    description: 'Tasks derived from an approved, unchanged design.',
  },
  {
    from: 'TASKS_GENERATED',
    to: 'READY_FOR_IMPLEMENTATION',
    // Human only. This is the edge past which the PreToolUse hook permits file edits, so
    // it is an approval in substance and is gated like one — no agent can release its
    // own task list for implementation.
    allowedActors: HUMAN_ONLY,
    guards: ['tasks_artifact_exists', 'design_approved_and_unchanged'],
    description: 'Release the spec for implementation. File edits become permitted here.',
  },
  {
    from: 'TASKS_GENERATED',
    to: 'DESIGN_APPROVED',
    allowedActors: HUMAN_ONLY,
    guards: ['design_approved_and_unchanged'],
    description: 'Tasks rejected or sent back; the Task Agent can run again.',
  },
  {
    from: 'READY_FOR_IMPLEMENTATION',
    to: 'IMPLEMENTING',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: [],
    description: 'An implementing agent claimed its first task.',
  },
  {
    from: 'IMPLEMENTING',
    to: 'READY_FOR_IMPLEMENTATION',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: [],
    description: 'Implementation paused; no task is in progress.',
  },
  {
    from: 'IMPLEMENTING',
    to: 'DONE',
    allowedActors: HUMAN_OR_AUTOMATED,
    guards: [],
    description: 'Every task is complete.',
  },
];

/** `FAILED` is reachable from any non-terminal state and is itself terminal. */
const FAILURE_EDGES: readonly TransitionRule[] = SPEC_STATES.filter(
  (s) => s !== 'DONE' && s !== 'FAILED',
).map((from) => ({
  from,
  to: 'FAILED' as const,
  allowedActors: HUMAN_OR_AUTOMATED,
  guards: [],
  description: 'Unrecoverable failure; the spec is parked and a new one must be created.',
}));

export const TRANSITION_RULES: readonly TransitionRule[] = [...EDGES, ...FAILURE_EDGES];

const RULE_INDEX: ReadonlyMap<string, TransitionRule> = new Map(
  TRANSITION_RULES.map((rule) => [`${rule.from}>${rule.to}`, rule]),
);

/** Looks up an edge, or `undefined` when the move is illegal. */
export function findRule(from: SpecState, to: SpecState): TransitionRule | undefined {
  return RULE_INDEX.get(`${from}>${to}`);
}

/**
 * Every state reachable from `from`, excluding `FAILED`.
 *
 * The API returns this so the UI can avoid offering an action that would 409 — the
 * state machine stays the single source of truth for what is possible, rather than
 * being re-implemented in the frontend.
 */
export function nextStates(from: SpecState): readonly SpecState[] {
  return TRANSITION_RULES.filter((r) => r.from === from && r.to !== 'FAILED').map((r) => r.to);
}

/** Which artifact kind, if any, a state transition is gated on. Used for messaging. */
export const ARTIFACT_FOR_STATE: Partial<Record<SpecState, ArtifactKind>> = {
  CONTEXT_SCANNING: 'context',
  CONTEXT_READY: 'context',
  REQ_DRAFTING: 'requirements',
  REQ_AWAITING_APPROVAL: 'requirements',
  REQ_APPROVED: 'requirements',
  DESIGN_DRAFTING: 'design',
  DESIGN_AWAITING_APPROVAL: 'design',
  DESIGN_APPROVED: 'design',
  TASKS_GENERATED: 'tasks',
};
