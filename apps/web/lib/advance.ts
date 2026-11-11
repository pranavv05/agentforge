import type { SpecState } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import { nextStates, transition, type SpecRow } from '@agentforge/orchestrator';

/**
 * Moves a spec into a working state before its agent runs.
 *
 * Until now nothing over HTTP could do this. The agents require their own drafting state
 * — `draftRequirements` refuses outside `REQ_DRAFTING` — but no route moved a spec into
 * one, so the pipeline could only be driven by a script calling `transition()` directly.
 * A user interface could create a spec and then do nothing with it.
 *
 * The orchestrator still performs the move, as the orchestrator. This is not an agent
 * transitioning itself: the route asks for the state change, the agent runs afterwards
 * and writes its artifact as an `agent` actor, and the audit log keeps the two apart.
 *
 * **Only unambiguous continuations are taken automatically.** The transition table also
 * permits `REQ_AWAITING_APPROVAL → REQ_DRAFTING` and
 * `DESIGN_AWAITING_APPROVAL → DESIGN_DRAFTING` — redrafting instead of deciding — and
 * those are deliberately excluded here. Abandoning a pending approval gate is a decision
 * a human should make explicitly through `request_changes`, not something that happens
 * as a side effect of pressing a draft button.
 */

/**
 * The only states this may ever advance *into*.
 *
 * A working state means "an agent is about to run here". A result state means "an agent
 * finished and moved the spec itself" — TASKS_GENERATED is the latter, and its incoming
 * edge carries a `tasks_artifact_exists` guard so the state cannot be claimed without
 * the artifact. Advancing into it before the Task Agent ran produced a 409 from that
 * guard, which is the state machine behaving correctly against a route that should not
 * have been asking.
 *
 * Narrowing the type is what stops that recurring: a result state is no longer
 * expressible as a target.
 */
type WorkingState = Extract<SpecState, 'CONTEXT_SCANNING' | 'REQ_DRAFTING' | 'DESIGN_DRAFTING'>;

/** States from which advancing into a working state is an obvious continuation. */
const AUTO_ADVANCE_FROM: Readonly<Record<SpecState, readonly WorkingState[]>> = {
  CREATED: ['CONTEXT_SCANNING', 'REQ_DRAFTING'],
  CONTEXT_READY: ['CONTEXT_SCANNING', 'REQ_DRAFTING'],
  REQ_AWAITING_CLARIFICATION: ['REQ_DRAFTING'],
  REQ_APPROVED: ['DESIGN_DRAFTING'],
  DESIGN_APPROVED: [],

  // Everything else advances only through a human decision or an agent completing.
  CONTEXT_SCANNING: [],
  REQ_DRAFTING: [],
  REQ_AWAITING_APPROVAL: [],
  DESIGN_DRAFTING: [],
  DESIGN_AWAITING_APPROVAL: [],
  TASKS_GENERATED: [],
  READY_FOR_IMPLEMENTATION: [],
  IMPLEMENTING: [],
  DONE: [],
  FAILED: [],
};

export interface AdvanceResult {
  /** The spec as it now stands — moved, or unchanged if it was already there. */
  readonly spec: SpecRow;
  readonly moved: boolean;
}

/**
 * Advances `spec` to `target` when that is a legal, unambiguous next step.
 *
 * A no-op when the spec is already in the target state, so a retry is harmless. When the
 * move is neither legal nor already done, it returns the spec untouched and lets the
 * agent's own precondition check produce the error — that message names the state and
 * the stage, which is more useful than a generic refusal from here.
 */
export function advanceTo(
  db: Db,
  spec: SpecRow,
  target: WorkingState,
  correlationId: string,
): AdvanceResult {
  if (spec.status === target) return { spec, moved: false };

  const allowed = AUTO_ADVANCE_FROM[spec.status].includes(target);
  // Checked against the orchestrator's own table as well, so this list can never admit
  // an edge the state machine does not have.
  if (!allowed || !nextStates(spec.status).includes(target)) {
    return { spec, moved: false };
  }

  const result = transition(db, {
    specId: spec.id,
    from: spec.status,
    to: target,
    actor: { id: 'orchestrator', type: 'orchestrator' },
    expectedVersion: spec.version,
    correlationId,
    payload: { requested_over_http: true },
  });

  return { spec: result.spec, moved: true };
}
