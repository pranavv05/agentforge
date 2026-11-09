import { z } from 'zod';
import {
  AcceptanceCriterionIdSchema,
  ComplianceRuleKeySchema,
  DesignSectionIdSchema,
  RequirementIdSchema,
  TaskIdSchema,
} from './ids.ts';

/**
 * Compliance pack schemas.
 *
 * A compliance pack turns regulation into *testable acceptance criteria* and then
 * traces each one forward: rule to requirement to design section to task to test.
 * The pack is versioned on purpose — the Income-tax Act 2025 replacing the 194-series
 * with Section 393 is precisely the case that proves an unversioned pack is useless.
 */

export const JURISDICTIONS = ['IN'] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

/** Which regulatory domain a rule belongs to. Prefixes the rule key. */
export const COMPLIANCE_DOMAINS = ['GST', 'TDS'] as const;

export type ComplianceDomain = (typeof COMPLIANCE_DOMAINS)[number];

/**
 * A rule's enforcement severity.
 *
 * `blocking` rules make an artifact unapprovable while violated — that is the whole
 * point of "compliance as acceptance criteria" rather than compliance as a checklist.
 */
export const COMPLIANCE_SEVERITIES = ['blocking', 'warning', 'advisory'] as const;

export type ComplianceSeverity = (typeof COMPLIANCE_SEVERITIES)[number];

/**
 * A criterion template, injected into requirements verbatim in Given/When/Then form.
 *
 * Ids are assigned at injection time, so the template itself carries no id.
 */
export const ComplianceCriterionTemplateSchema = z.strictObject({
  given: z.string().min(1).max(1000),
  when: z.string().min(1).max(1000),
  then: z.string().min(1).max(1000),
});

export type ComplianceCriterionTemplate = z.infer<typeof ComplianceCriterionTemplateSchema>;

/**
 * A detector for superseded terminology.
 *
 * The demo case: a design citing "Section 194J" is rejected and mapped to Section 393.
 * `pattern` is a case-insensitive regular expression source string, validated at load
 * time so a malformed pack fails loudly instead of silently matching nothing.
 */
export const SupersededTermSchema = z.strictObject({
  /** Regular-expression source, e.g. `section\\s*194J`. Compiled case-insensitively. */
  pattern: z.string().min(1).max(500),
  /** What the author should have cited instead. */
  replacement: z.string().min(1).max(500),
  /** Reviewer-facing explanation of the change. */
  explanation: z.string().min(1).max(1000),
});

export type SupersededTerm = z.infer<typeof SupersededTermSchema>;

export const ComplianceRuleSchema = z.strictObject({
  key: ComplianceRuleKeySchema,
  domain: z.enum(COMPLIANCE_DOMAINS),
  jurisdiction: z.enum(JURISDICTIONS),
  title: z.string().min(1).max(200),
  /** The obligation in plain language, as it will appear in requirements.md. */
  requirement_text: z.string().min(1).max(2000),
  severity: z.enum(COMPLIANCE_SEVERITIES),
  acceptance_criteria: z.array(ComplianceCriterionTemplateSchema).min(1).max(10),
  /**
   * Keywords that make this rule applicable to a feature. Matched against the feature
   * description and the requirements text; a rule that matches nothing is not injected.
   */
  applies_when_any: z.array(z.string().min(1).max(100)).min(1).max(30),
  superseded_terms: z.array(SupersededTermSchema).max(10),
  /** Statutory or official-documentation citation. Rendered into the spec for audit. */
  citation: z.string().min(1).max(500),
  /**
   * Known disagreement between sources, recorded rather than silently resolved.
   * The TDS threshold conflict is real and the report has to disclose it.
   */
  source_conflict_note: z.string().max(1000).nullable(),
});

export type ComplianceRule = z.infer<typeof ComplianceRuleSchema>;

export const CompliancePackSchema = z.strictObject({
  /** Semver. Bumped whenever any rule changes; approvals record the version used. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'pack version must be semver'),
  /** ISO date the pack content was last reviewed against primary sources. */
  reviewed_on: z.iso.date(),
  rules: z.array(ComplianceRuleSchema).min(1).max(50),
});

export type CompliancePack = z.infer<typeof CompliancePackSchema>;

/**
 * One row of the traceability matrix.
 *
 * Nullable downstream fields are deliberate: a trace with a requirement but no task
 * yet is exactly the gap the *traceability coverage* metric is meant to surface.
 */
export const ComplianceTraceSchema = z.strictObject({
  rule_key: ComplianceRuleKeySchema,
  requirement_id: RequirementIdSchema.nullable(),
  acceptance_criterion_id: AcceptanceCriterionIdSchema.nullable(),
  design_section_id: DesignSectionIdSchema.nullable(),
  task_id: TaskIdSchema.nullable(),
  /** Test identifier, e.g. `packages/foo/test/gst.test.ts > rejects missing IRN`. */
  test_ref: z.string().min(1).max(500).nullable(),
});

export type ComplianceTrace = z.infer<typeof ComplianceTraceSchema>;

/** A terminology violation found by the superseded-term detector. */
export const ComplianceViolationSchema = z.strictObject({
  rule_key: ComplianceRuleKeySchema,
  severity: z.enum(COMPLIANCE_SEVERITIES),
  /** Where it was found, e.g. `design.sections[2].body`. */
  location: z.string().min(1).max(200),
  matched_text: z.string().min(1).max(500),
  replacement: z.string().min(1).max(500),
  explanation: z.string().min(1).max(1000),
});

export type ComplianceViolation = z.infer<typeof ComplianceViolationSchema>;

/**
 * Coverage report for one spec.
 *
 * `coverage_rate` counts rules traced all the way to a task, because a rule that
 * stops at a requirement has not actually been built.
 */
export const ComplianceCoverageSchema = z.strictObject({
  pack_version: z.string(),
  applicable_rules: z.number().int().nonnegative(),
  traced_to_requirement: z.number().int().nonnegative(),
  traced_to_design: z.number().int().nonnegative(),
  traced_to_task: z.number().int().nonnegative(),
  traced_to_test: z.number().int().nonnegative(),
  coverage_rate: z.number().min(0).max(1),
  traces: z.array(ComplianceTraceSchema),
  violations: z.array(ComplianceViolationSchema),
});

export type ComplianceCoverage = z.infer<typeof ComplianceCoverageSchema>;
