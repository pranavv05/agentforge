/**
 * `@agentforge/orchestrator` — the deterministic state machine.
 *
 * This package is the governance differentiator: stage transitions are owned here,
 * approvals bind to content hashes, and every move lands in an append-only audit log.
 * Agents call into it to write proposals; they never move a spec themselves.
 */

export {
  TRANSITION_RULES,
  ARTIFACT_FOR_STATE,
  GUARDS,
  findRule,
  nextStates,
  type GuardName,
  type TransitionRule,
} from './transitions.ts';

export {
  appendAudit,
  requireSpec,
  transition,
  transitionInTx,
  type TransitionInput,
  type TransitionResult,
} from './transition.ts';

export {
  ALLOWED_WRITE_STATES,
  getArtifactVersion,
  getHeadArtifact,
  listArtifactVersions,
  listHeadArtifacts,
  writeArtifact,
  type WriteArtifactInput,
  type WriteArtifactResult,
} from './artifacts.ts';

export {
  createSpec,
  getSpec,
  listSpecs,
  requireSpecById,
  type CreateSpecInput,
  type ListSpecsResult,
} from './specs.ts';

export {
  decideArtifact,
  latestApproval,
  listApprovals,
  type DecideArtifactInput,
  type DecideArtifactResult,
} from './approvals.ts';

export {
  CACHE_WRITE_MULTIPLIER,
  MODEL_PRICING,
  assertWithinBudget,
  budgetCapUsd,
  computeCost,
  getCostSummary,
  recordLlmCall,
  spentOnSpec,
  type CacheTtl,
  type ModelPricing,
  type RecordLlmCallInput,
  type TokenUsage,
} from './cost.ts';

export { listAuditEntries, listAuditEntriesByCorrelation } from './audit.ts';

export {
  buildContextBundle,
  evidenceStats,
  listEvidence,
  listVerifiedEvidence,
  replaceEvidence,
  type EvidenceInput,
  type EvidenceStats,
} from './evidence.ts';

export {
  answerClarifications,
  askClarifications,
  latestAnsweredRound,
  listClarifications,
  listOpenClarifications,
  nextRound,
  type ClarificationAnswer,
  type ClarificationView,
} from './clarifications.ts';

export {
  getTask,
  listTasks,
  nextAvailableTask,
  syncTasks,
  tasksWithMissingDependencies,
} from './tasks.ts';

export { headArtifact, runGuards, type GuardContext } from './guards.ts';
export { newId, type IdPrefix } from './ids.ts';
export { logger, newCorrelationId, runLogger } from './logger.ts';
export type { Actor, ArtifactRow, SpecRow, Tx } from './types.ts';
