/**
 * Spec lifecycle states and artifact kinds.
 *
 * These names are part of the frozen public contract: the API exposes them, the
 * UI renders them, and the Claude Code PreToolUse hook gates on them. The
 * *transition table* deliberately lives in `@agentforge/orchestrator`, not here —
 * the contract says which states exist, the orchestrator owns which moves are legal.
 */

/**
 * Every spec state, in rough lifecycle order.
 *
 * `CONTEXT_SCANNING` / `CONTEXT_READY` occur only for brownfield specs; greenfield
 * specs go straight from `CREATED` to `REQ_DRAFTING`.
 */
export const SPEC_STATES = [
  'CREATED',

  // Brownfield only: Context Agent stages 0-3.
  'CONTEXT_SCANNING',
  'CONTEXT_READY',

  // Requirements.
  'REQ_DRAFTING',
  'REQ_AWAITING_CLARIFICATION',
  'REQ_AWAITING_APPROVAL',
  'REQ_APPROVED',

  // Design.
  'DESIGN_DRAFTING',
  'DESIGN_AWAITING_APPROVAL',
  'DESIGN_APPROVED',

  // Tasks and implementation.
  'TASKS_GENERATED',
  'READY_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'DONE',

  // Terminal failure. Reached only via an explicit transition, never implicitly.
  'FAILED',
] as const;

export type SpecState = (typeof SPEC_STATES)[number];

/** Runtime membership test that narrows an arbitrary string to a `SpecState`. */
export function isSpecState(value: string): value is SpecState {
  return (SPEC_STATES as readonly string[]).includes(value);
}

/**
 * The only two states in which editing files is permitted.
 *
 * The PreToolUse hook denies Edit/Write for any spec outside this set. Exported so
 * the hook, the MCP server and the UI all gate on one definition rather than three
 * copies of the same literal list.
 */
export const IMPLEMENTATION_STATES = ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING'] as const;

export type ImplementationState = (typeof IMPLEMENTATION_STATES)[number];

export function isImplementationState(state: SpecState): state is ImplementationState {
  return (IMPLEMENTATION_STATES as readonly SpecState[]).includes(state);
}

/** States in which a human decision is outstanding. Used by the UI inbox. */
export const AWAITING_HUMAN_STATES = [
  'REQ_AWAITING_CLARIFICATION',
  'REQ_AWAITING_APPROVAL',
  'DESIGN_AWAITING_APPROVAL',
  // Tasks wait for a human too: approving them is what releases the spec for
  // implementation. Leaving it out meant a spec sat at this gate without the interface
  // ever saying it needed anyone — which is how it went unnoticed that nothing in the
  // product performed that transition at all.
  'TASKS_GENERATED',
] as const;

export type AwaitingHumanState = (typeof AWAITING_HUMAN_STATES)[number];

export function isAwaitingHuman(state: SpecState): state is AwaitingHumanState {
  return (AWAITING_HUMAN_STATES as readonly SpecState[]).includes(state);
}

/** Terminal states: no outgoing transitions exist. */
export const TERMINAL_STATES = ['DONE', 'FAILED'] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminalState(state: SpecState): state is TerminalState {
  return (TERMINAL_STATES as readonly SpecState[]).includes(state);
}

/** The four artifact kinds a spec accumulates, in generation order. */
export const ARTIFACT_KINDS = ['context', 'requirements', 'design', 'tasks'] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Greenfield specs have no existing codebase; brownfield specs run the Context Agent. */
export const SPEC_MODES = ['greenfield', 'brownfield'] as const;

export type SpecMode = (typeof SPEC_MODES)[number];

/**
 * Who performed an action.
 *
 * The distinction is load-bearing for the governance claim: `agent` actors may only
 * ever write proposal artifacts, while state transitions are attributed to `human`
 * or `orchestrator`. The audit log keeps this so a reviewer can prove no agent ever
 * approved its own output.
 */
export const ACTOR_TYPES = ['human', 'agent', 'orchestrator', 'system'] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

/** A human decision on a proposed artifact. */
export const APPROVAL_DECISIONS = ['approve', 'reject', 'request_changes'] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Implementation status of a single task. */
export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Pipeline stage, used to attribute token spend in `llm_calls`.
 *
 * Kept separate from `SpecState` because several stages run inside one state (the
 * Context Agent makes `context_scan`, `module_summary` and `context_loop` calls
 * while the spec sits in `CONTEXT_SCANNING`).
 */
export const LLM_STAGES = [
  'context_scan',
  'module_summary',
  'context_loop',
  'requirements',
  'clarification',
  'design',
  'tasks',
  'compliance',
  'eval',
] as const;

export type LlmStage = (typeof LLM_STAGES)[number];

/**
 * Which artifact kind each drafting state produces.
 *
 * Used by the orchestrator to resolve "the artifact under review" without a switch
 * at every call site, and by `CHANGES_REQUESTED` handling to find the state to
 * return to.
 */
export const DRAFTING_STATE_FOR_ARTIFACT = {
  context: 'CONTEXT_SCANNING',
  requirements: 'REQ_DRAFTING',
  design: 'DESIGN_DRAFTING',
  // DESIGN_APPROVED, not TASKS_GENERATED. The Task Agent runs *from* an approved design
  // and reaches TASKS_GENERATED by writing; that state is its result, not the place the
  // work happens. Having it here meant "send the tasks back to be redone" resolved to a
  // self-transition, which is not an edge the table has.
  tasks: 'DESIGN_APPROVED',
} as const satisfies Record<ArtifactKind, SpecState>;

/**
 * Which state an artifact kind waits in for human approval, if it has a gate.
 *
 * Tasks wait in TASKS_GENERATED. That gate was missing, and its absence was not a
 * simplification: `TASKS_GENERATED -> READY_FOR_IMPLEMENTATION` is the edge after which
 * the PreToolUse hook starts permitting file edits, and nothing in the product performed
 * it. A spec that reached TASKS_GENERATED stopped there forever, and the implementation
 * phase — the MCP server, the hook, Case A — was unreachable.
 *
 * Making it an approval rather than a plain transition is the right shape anyway: the
 * decision that unlocks writing to a repository should bind to a content hash and name
 * the human who took it, exactly like the two gates before it.
 */
export const APPROVAL_STATE_FOR_ARTIFACT = {
  context: null,
  requirements: 'REQ_AWAITING_APPROVAL',
  design: 'DESIGN_AWAITING_APPROVAL',
  tasks: 'TASKS_GENERATED',
} as const satisfies Record<ArtifactKind, SpecState | null>;

/**
 * The retrieval strategies the Context Agent can run.
 *
 * Spelled once here and derived everywhere else — the HTTP request schema, the agent's
 * tool selection and the eval harness's arms all read from this list, so the arms the
 * API accepts cannot drift from the arms the code implements.
 *
 * `fts_repomap_embed` is the optional fourth ablation the plan described. It is named
 * because the contract is frozen and removing it would be a breaking change; it is not
 * implemented, and the agent refuses it rather than quietly serving a different arm
 * under its name.
 */
export const RETRIEVAL_STRATEGY_NAMES = [
  'grep',
  'repomap',
  'fts_repomap',
  'fts_repomap_embed',
] as const;

export type RetrievalStrategyName = (typeof RETRIEVAL_STRATEGY_NAMES)[number];
