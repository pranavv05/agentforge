/**
 * `@agentforge/agents` — the Requirement, Design and Task agents.
 *
 * Each agent proposes a structured artifact through a validated schema; the markdown is
 * rendered deterministically from that JSON. Agents never transition a spec and never
 * approve their own output — they write a proposal and the orchestrator decides.
 */

export * from './render/index.ts';

export {
  MAX_CLARIFICATION_ROUNDS,
  draftRequirements,
  type DraftRequirementsInput,
  type DraftRequirementsResult,
} from './requirement.ts';

export { draftDesign, type DraftDesignInput, type DraftDesignResult } from './design.ts';

export {
  checkAllCitations,
  checkCitations,
  describeViolations,
  type CitationViolation,
} from './citations.ts';

export {
  approvedArtifactSection,
  clarificationSection,
  contextSummarySection,
  evidenceSection,
  requestSection,
  roundBudgetSection,
  skillSection,
} from './sections.ts';
