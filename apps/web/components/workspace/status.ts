import type { SpecState } from '@agentforge/contract';

/**
 * What a state means to the person looking at it.
 *
 * Fifteen states is the right number for a transition table and far too many colours
 * for a sidebar. They collapse into four tones, chosen by what the reader has to *do*
 * rather than by where the state sits in the pipeline:
 *
 * - `wait` — it is your turn. The only tone that should ever pull the eye.
 * - `live` — something is running; come back shortly.
 * - `done` — finished, nothing owed.
 * - `calm` — in progress but not yours, and not moving on its own.
 *
 * Keeping this in one place is why the rail and the header cannot disagree about
 * whether a spec needs you.
 */
export type Tone = 'wait' | 'live' | 'done' | 'calm' | 'fail';

const TONES: Readonly<Record<SpecState, Tone>> = {
  CREATED: 'calm',
  CONTEXT_SCANNING: 'live',
  CONTEXT_READY: 'calm',
  REQ_DRAFTING: 'live',
  REQ_AWAITING_CLARIFICATION: 'wait',
  REQ_AWAITING_APPROVAL: 'wait',
  REQ_APPROVED: 'calm',
  DESIGN_DRAFTING: 'live',
  DESIGN_AWAITING_APPROVAL: 'wait',
  DESIGN_APPROVED: 'calm',
  TASKS_GENERATED: 'wait',
  READY_FOR_IMPLEMENTATION: 'calm',
  IMPLEMENTING: 'live',
  DONE: 'done',
  FAILED: 'fail',
};

export function toneFor(state: SpecState): Tone {
  return TONES[state];
}

/**
 * The state as a short phrase.
 *
 * `REQ_AWAITING_APPROVAL` is precise and unreadable at a glance. The code is still
 * shown wherever a reader might be checking it against the transition table — in the
 * thread, and in the header's tooltip — but a list of twenty threads should read as
 * English.
 */
const LABELS: Readonly<Record<SpecState, string>> = {
  CREATED: 'Just created',
  CONTEXT_SCANNING: 'Scanning the repo',
  CONTEXT_READY: 'Scan complete',
  REQ_DRAFTING: 'Drafting requirements',
  REQ_AWAITING_CLARIFICATION: 'Needs your answers',
  REQ_AWAITING_APPROVAL: 'Requirements to review',
  REQ_APPROVED: 'Requirements approved',
  DESIGN_DRAFTING: 'Drafting the design',
  DESIGN_AWAITING_APPROVAL: 'Design to review',
  DESIGN_APPROVED: 'Design approved',
  TASKS_GENERATED: 'Tasks to review',
  READY_FOR_IMPLEMENTATION: 'Ready to implement',
  IMPLEMENTING: 'Implementing',
  DONE: 'Done',
  FAILED: 'Failed',
};

export function labelFor(state: SpecState): string {
  return LABELS[state];
}
