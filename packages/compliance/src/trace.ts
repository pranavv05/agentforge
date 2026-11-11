import type {
  ComplianceCoverage,
  ComplianceRule,
  ComplianceTrace,
  ComplianceViolation,
  DesignProposal,
  RequirementsProposal,
  TasksProposal,
} from '@agentforge/contract';

/**
 * The traceability matrix.
 *
 * One row per (rule, acceptance criterion), carrying that obligation as far forward as
 * the artifacts actually take it: rule → requirement → design section → task → test.
 *
 * The value is in the *gaps*. A rule that stops at a requirement has been written down
 * and not built; one that stops at a design section has been designed and not scheduled.
 * `coverage_rate` therefore counts only rules that reach a task, because that is the
 * first point at which something will actually be implemented.
 */

export interface TraceInput {
  readonly packVersion: string;
  readonly applicableRules: readonly ComplianceRule[];
  readonly requirements: RequirementsProposal | null;
  readonly design: DesignProposal | null;
  readonly tasks: TasksProposal | null;
  readonly violations: readonly ComplianceViolation[];
  /**
   * Test references keyed by acceptance-criterion id, supplied by the implementation
   * phase as tasks complete. Empty until then.
   */
  readonly testRefs?: ReadonlyMap<string, string>;
}

export function buildTraceMatrix(input: TraceInput): ComplianceCoverage {
  const requirements = input.requirements?.requirements ?? [];
  const sections = input.design?.sections ?? [];
  const tasks = input.tasks?.tasks ?? [];
  const testRefs = input.testRefs ?? new Map<string, string>();

  // Which requirement each criterion belongs to.
  const requirementOfCriterion = new Map<string, string>();
  for (const requirement of requirements) {
    for (const criterion of requirement.acceptance_criteria) {
      requirementOfCriterion.set(criterion.id, requirement.id);
    }
  }

  // Design sections, indexed by the requirement they realise.
  const sectionsForRequirement = new Map<string, string[]>();
  for (const section of sections) {
    for (const requirementId of section.requirement_ids) {
      sectionsForRequirement.set(requirementId, [
        ...(sectionsForRequirement.get(requirementId) ?? []),
        section.id,
      ]);
    }
  }

  // A task covers a criterion either by naming it in `verifies` — the precise link — or
  // by implementing its requirement. The second is weaker but still real: the work is
  // scheduled, just not pinned to the individual criterion.
  const tasksVerifyingCriterion = new Map<string, string[]>();
  const tasksForRequirement = new Map<string, string[]>();
  for (const task of tasks) {
    for (const criterionId of task.verifies) {
      tasksVerifyingCriterion.set(criterionId, [
        ...(tasksVerifyingCriterion.get(criterionId) ?? []),
        task.id,
      ]);
    }
    for (const requirementId of task.requirement_ids) {
      tasksForRequirement.set(requirementId, [
        ...(tasksForRequirement.get(requirementId) ?? []),
        task.id,
      ]);
    }
  }

  const traces: ComplianceTrace[] = [];

  for (const rule of input.applicableRules) {
    // Every criterion that cites this rule, across all requirements.
    const citing = requirements.flatMap((requirement) =>
      requirement.acceptance_criteria
        .filter((criterion) => criterion.compliance_rule_key === rule.key)
        .map((criterion) => ({ requirement, criterion })),
    );

    if (citing.length === 0) {
      // The rule applies but nothing references it: the most important gap to surface,
      // so it gets a row with everything downstream null rather than being omitted.
      traces.push({
        rule_key: rule.key,
        requirement_id: null,
        acceptance_criterion_id: null,
        design_section_id: null,
        task_id: null,
        test_ref: null,
      });
      continue;
    }

    for (const { requirement, criterion } of citing) {
      const designSectionId = sectionsForRequirement.get(requirement.id)?.[0] ?? null;
      const taskId =
        tasksVerifyingCriterion.get(criterion.id)?.[0] ??
        tasksForRequirement.get(requirement.id)?.[0] ??
        null;

      traces.push({
        rule_key: rule.key,
        requirement_id: requirement.id,
        acceptance_criterion_id: criterion.id,
        design_section_id: designSectionId,
        task_id: taskId,
        test_ref: testRefs.get(criterion.id) ?? null,
      });
    }
  }

  // Counted per *rule*, not per row: a rule with three criteria that all reach a task
  // is one rule covered, not three.
  const ruleKeys = new Set(input.applicableRules.map((r) => r.key));
  const reached = (predicate: (trace: ComplianceTrace) => boolean): number => {
    const keys = new Set(
      traces
        .filter((trace) => ruleKeys.has(trace.rule_key) && predicate(trace))
        .map((t) => t.rule_key),
    );
    return keys.size;
  };

  const applicable = ruleKeys.size;
  const tracedToTask = reached((t) => t.task_id !== null);

  return {
    pack_version: input.packVersion,
    applicable_rules: applicable,
    traced_to_requirement: reached((t) => t.requirement_id !== null),
    traced_to_design: reached((t) => t.design_section_id !== null),
    traced_to_task: tracedToTask,
    traced_to_test: reached((t) => t.test_ref !== null),
    coverage_rate: applicable === 0 ? 0 : tracedToTask / applicable,
    traces,
    violations: [...input.violations],
  };
}

/** Rules that apply but are referenced by nothing. The actionable gap list. */
export function untracedRules(coverage: ComplianceCoverage): readonly string[] {
  const traced = new Set(
    coverage.traces.filter((t) => t.requirement_id !== null).map((t) => t.rule_key),
  );
  return [...new Set(coverage.traces.map((t) => t.rule_key))].filter((key) => !traced.has(key));
}

/** Rules that reach a requirement but no task: written down, not scheduled. */
export function unscheduledRules(coverage: ComplianceCoverage): readonly string[] {
  const byRule = new Map<string, ComplianceTrace[]>();
  for (const trace of coverage.traces) {
    byRule.set(trace.rule_key, [...(byRule.get(trace.rule_key) ?? []), trace]);
  }

  return [...byRule.entries()]
    .filter(
      ([, rows]) =>
        rows.some((r) => r.requirement_id !== null) && rows.every((r) => r.task_id === null),
    )
    .map(([key]) => key);
}
