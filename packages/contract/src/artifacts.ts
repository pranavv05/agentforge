import { z } from 'zod';
import {
  AcceptanceCriterionIdSchema,
  ComplianceRuleKeySchema,
  DecisionIdSchema,
  DesignSectionIdSchema,
  RequirementIdSchema,
  TaskIdSchema,
} from './ids.ts';
import { SourceRefSchema } from './evidence.ts';
import { TASK_STATUSES } from './states.ts';

/**
 * Artifact payload schemas.
 *
 * Each agent emits one of the `*ProposalSchema` shapes through strict tool use, and
 * the matching markdown document is rendered deterministically from that JSON.
 * Nothing parses model prose: there is no regex over markdown anywhere in this
 * system, which is what makes the traceability ids trustworthy.
 */

// --------------------------------------------------------------------------
// Requirements
// --------------------------------------------------------------------------

/**
 * EARS — Easy Approach to Requirements Syntax.
 *
 * Constraining requirements to these five patterns makes them mechanically checkable
 * for shape, and it is the convention Spec Kit and Kiro also settled on.
 *
 * - `ubiquitous`          — The <system> shall <response>.
 * - `event_driven`        — When <trigger>, the <system> shall <response>.
 * - `state_driven`        — While <state>, the <system> shall <response>.
 * - `unwanted_behaviour`  — If <condition>, then the <system> shall <response>.
 * - `optional_feature`    — Where <feature included>, the <system> shall <response>.
 */
export const EARS_PATTERNS = [
  'ubiquitous',
  'event_driven',
  'state_driven',
  'unwanted_behaviour',
  'optional_feature',
] as const;

export type EarsPattern = (typeof EARS_PATTERNS)[number];

export const RequirementPrioritySchema = z.enum(['must', 'should', 'could']);

export type RequirementPriority = z.infer<typeof RequirementPrioritySchema>;

/**
 * A testable acceptance criterion in Given/When/Then form.
 *
 * GWT is not decoration: the compliance pack injects criteria in exactly this shape,
 * and `compliance_traces.test_ref` later points at the test that implements one.
 */
export const AcceptanceCriterionSchema = z.strictObject({
  id: AcceptanceCriterionIdSchema,
  given: z.string().min(1).max(1000),
  when: z.string().min(1).max(1000),
  then: z.string().min(1).max(1000),
  /** Set when this criterion was injected by a compliance rule rather than authored. */
  compliance_rule_key: ComplianceRuleKeySchema.nullable(),
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const RequirementSchema = z.strictObject({
  id: RequirementIdSchema,
  ears_pattern: z.enum(EARS_PATTERNS),
  ears_statement: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(2000),
  priority: RequirementPrioritySchema,
  acceptance_criteria: z.array(AcceptanceCriterionSchema).min(1).max(20),
  /** Codebase citations. Empty for greenfield specs; verified for brownfield ones. */
  source_refs: z.array(SourceRefSchema).max(20),
  compliance_refs: z.array(ComplianceRuleKeySchema).max(20),
});

export type Requirement = z.infer<typeof RequirementSchema>;

/** A question the Requirement Agent needs answered before it can finish. */
export const ClarificationQuestionSchema = z.strictObject({
  question: z.string().min(1).max(1000),
  /** Why the answer changes the requirements — stops the agent asking idle questions. */
  why_it_matters: z.string().min(1).max(1000),
  /** Suggested answers, so a reviewer can usually click rather than type. */
  options: z.array(z.string().min(1).max(500)).max(6),
});

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

/**
 * The Requirement Agent's output.
 *
 * It either asks clarifying questions or proposes requirements. Modelling this as
 * one schema with both arrays, rather than a union, keeps the tool schema flat —
 * which strict tool use handles far more reliably.
 */
export const RequirementsProposalSchema = z.strictObject({
  feature_summary: z.string().min(1).max(4000),
  requirements: z.array(RequirementSchema).max(60),
  clarification_questions: z.array(ClarificationQuestionSchema).max(8),
  /** Explicitly out of scope. Recorded because scope creep is the top project risk. */
  non_goals: z.array(z.string().min(1).max(500)).max(20),
});

export type RequirementsProposal = z.infer<typeof RequirementsProposalSchema>;

// --------------------------------------------------------------------------
// Design
// --------------------------------------------------------------------------

/**
 * One section of design.md.
 *
 * `source_refs` is the load-bearing field: for a brownfield spec every section that
 * asserts something about existing code must cite it, and the grounding verifier
 * flags the section if the citation does not check out.
 */
export const DesignSectionSchema = z.strictObject({
  id: DesignSectionIdSchema,
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  source_refs: z.array(SourceRefSchema).max(40),
  /** Requirements this section realises. Drives the forward trace matrix. */
  requirement_ids: z.array(RequirementIdSchema).max(60),
});

export type DesignSection = z.infer<typeof DesignSectionSchema>;

/** A recorded architectural decision, ADR-style but inline. */
export const DesignDecisionSchema = z.strictObject({
  id: DecisionIdSchema,
  decision: z.string().min(1).max(1000),
  rationale: z.string().min(1).max(2000),
  alternatives_considered: z.array(z.string().min(1).max(500)).max(10),
});

export type DesignDecision = z.infer<typeof DesignDecisionSchema>;

export const DesignProposalSchema = z.strictObject({
  overview: z.string().min(1).max(8000),
  sections: z.array(DesignSectionSchema).min(1).max(40),
  decisions: z.array(DesignDecisionSchema).max(30),
  risks: z.array(z.string().min(1).max(1000)).max(20),
});

export type DesignProposal = z.infer<typeof DesignProposalSchema>;

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  status: z.enum(TASK_STATUSES),
  /** Requirements this task satisfies. A task citing none is a planning bug. */
  requirement_ids: z.array(RequirementIdSchema).min(1).max(30),
  design_section_ids: z.array(DesignSectionIdSchema).max(30),
  source_refs: z.array(SourceRefSchema).max(30),
  /** Acceptance criteria this task must make pass. Completes the trace to tests. */
  verifies: z.array(AcceptanceCriterionIdSchema).max(30),
  depends_on: z.array(TaskIdSchema).max(30),
});

export type Task = z.infer<typeof TaskSchema>;

export const TasksProposalSchema = z.strictObject({
  implementation_order_rationale: z.string().min(1).max(4000),
  tasks: z.array(TaskSchema).min(1).max(100),
});

export type TasksProposal = z.infer<typeof TasksProposalSchema>;
