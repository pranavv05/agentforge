import {
  DesignProposalSchema,
  GroundingError,
  RequirementsProposalSchema,
  type TasksProposal,
  TasksProposalSchema,
  TransitionError,
} from '@agentforge/contract';
import { type Db, parseJsonColumn } from '@agentforge/db';
import { complete } from '@agentforge/llm';
import {
  applicableRules,
  buildTraceMatrix,
  detectSupersededTerms,
  ensurePackInstalled,
  installedPackVersion,
  saveTraces,
} from '@agentforge/compliance';
import {
  findArtifactByIdempotencyKey,
  getHeadArtifact,
  listEvidence,
  newCorrelationId,
  requireSpecById,
  runLogger,
  syncTasks,
  transition,
  writeArtifact,
  type Actor,
  type ArtifactRow,
  type SpecRow,
} from '@agentforge/orchestrator';
import { checkAllCitations, describeViolations } from './citations.ts';
import { renderTasks } from './render/index.ts';
import {
  approvedArtifactSection,
  evidenceSection,
  requestSection,
  skillSection,
} from './sections.ts';

/**
 * The Task Agent.
 *
 * Breaks an approved design into ordered, independently verifiable tasks, then
 * materialises them as rows the implementation phase mutates.
 *
 * This is also where the compliance trace matrix is first computed end to end: tasks
 * are the last hop of rule → requirement → design → task, so until they exist the
 * matrix can only show gaps.
 */

const AGENT: Actor = { id: 'task-agent', type: 'agent' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

export interface GenerateTasksInput {
  readonly specId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

export interface GenerateTasksResult {
  readonly spec: SpecRow;
  readonly artifact: ArtifactRow;
  readonly proposal: TasksProposal;
  readonly tasksInserted: number;
  readonly costUsd: number;
}

/**
 * Finds a dependency cycle, or returns null.
 *
 * A cycle makes every task in it permanently unstartable, and `next_task` would simply
 * return nothing with no explanation. Detected here so the planning bug is reported
 * rather than discovered during implementation.
 */
function findCycle(proposal: TasksProposal): readonly string[] | null {
  const edges = new Map(proposal.tasks.map((t) => [t.id, t.depends_on] as const));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): readonly string[] | null => {
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') {
      // Return the cycle itself, so the error names the loop rather than one task.
      const from = stack.indexOf(id);
      return [...stack.slice(from), id];
    }

    state.set(id, 'visiting');
    stack.push(id);

    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const cycle = visit(next);
      if (cycle !== null) return cycle;
    }

    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const task of proposal.tasks) {
    const cycle = visit(task.id);
    if (cycle !== null) return cycle;
  }
  return null;
}

export async function generateTasks(
  db: Db,
  input: GenerateTasksInput,
): Promise<GenerateTasksResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const log = runLogger(correlationId, { spec_id: input.specId, agent: 'task' });

  // Replayable before the state guard, like the other agents: a retry of a call that
  // already landed must return its artifact rather than fail a precondition.
  const replay = findArtifactByIdempotencyKey(db, input.specId, 'tasks', input.idempotencyKey);
  if (replay !== undefined) {
    const spec = requireSpecById(db, input.specId);
    log.info({ artifact_version: replay.version }, 'tasks generation replayed');
    return {
      spec,
      artifact: replay,
      proposal: parseJsonColumn(
        TasksProposalSchema,
        replay.contentJson,
        `artifact_versions.content_json (tasks v${String(replay.version)})`,
      ),
      tasksInserted: 0,
      costUsd: 0,
    };
  }

  const spec = requireSpecById(db, input.specId);
  if (spec.status !== 'DESIGN_APPROVED') {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `tasks may only be generated while the spec is in DESIGN_APPROVED; it is in ${spec.status}`,
      { spec_id: spec.id, actual_state: spec.status },
    );
  }

  const requirementsArtifact = getHeadArtifact(db, spec.id, 'requirements');
  const designArtifact = getHeadArtifact(db, spec.id, 'design');
  if (requirementsArtifact === undefined || designArtifact === undefined) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      'both an approved requirements and an approved design artifact are needed to generate tasks',
      { spec_id: spec.id },
    );
  }

  const requirements = parseJsonColumn(
    RequirementsProposalSchema,
    requirementsArtifact.contentJson,
    `artifact_versions.content_json (requirements v${String(requirementsArtifact.version)})`,
  );
  const design = parseJsonColumn(
    DesignProposalSchema,
    designArtifact.contentJson,
    `artifact_versions.content_json (design v${String(designArtifact.version)})`,
  );

  const evidence = listEvidence(db, spec.id);

  const { output: proposal, costUsd } = await complete({
    db,
    specId: spec.id,
    stage: 'tasks',
    correlationId,
    schema: TasksProposalSchema,
    schemaName: 'tasks_proposal',
    sections: [
      skillSection('sdd-tasks'),
      evidenceSection(evidence),
      approvedArtifactSection('requirements', requirementsArtifact.contentMd),
      approvedArtifactSection('design', designArtifact.contentMd),
      requestSection(spec),
    ],
    userMessage:
      'Break the approved design into implementation tasks. Every task must trace to at ' +
      'least one requirement, and between them the tasks must cover every acceptance ' +
      'criterion in the approved requirements.',
  });

  // --- Structural checks, all before the artifact is written. -------------

  const knownRequirements = new Set(requirements.requirements.map((r) => r.id));
  const knownSections = new Set(design.sections.map((s) => s.id));
  const knownCriteria = new Set(
    requirements.requirements.flatMap((r) => r.acceptance_criteria.map((c) => c.id)),
  );
  const taskKeys = new Set(proposal.tasks.map((t) => t.id));

  const unknownRequirements = [...new Set(proposal.tasks.flatMap((t) => t.requirement_ids))].filter(
    (id) => !knownRequirements.has(id),
  );
  if (unknownRequirements.length > 0) {
    throw new GroundingError(
      `tasks reference requirement id(s) that do not exist: ${unknownRequirements.join(', ')}`,
      { spec_id: spec.id, unknown: unknownRequirements },
    );
  }

  const unknownSections = [...new Set(proposal.tasks.flatMap((t) => t.design_section_ids))].filter(
    (id) => !knownSections.has(id),
  );
  if (unknownSections.length > 0) {
    throw new GroundingError(
      `tasks reference design section id(s) that do not exist: ${unknownSections.join(', ')}`,
      { spec_id: spec.id, unknown: unknownSections },
    );
  }

  const unknownCriteria = [...new Set(proposal.tasks.flatMap((t) => t.verifies))].filter(
    (id) => !knownCriteria.has(id),
  );
  if (unknownCriteria.length > 0) {
    throw new GroundingError(
      `tasks claim to verify acceptance criteria that do not exist: ${unknownCriteria.join(', ')}`,
      { spec_id: spec.id, unknown: unknownCriteria },
    );
  }

  const missingDependencies = proposal.tasks.flatMap((task) =>
    task.depends_on.filter((dep) => !taskKeys.has(dep)).map((dep) => `${task.id} -> ${dep}`),
  );
  if (missingDependencies.length > 0) {
    throw new GroundingError(
      `tasks depend on task(s) that do not exist: ${missingDependencies.join(', ')}`,
      { spec_id: spec.id, missing: missingDependencies },
    );
  }

  const cycle = findCycle(proposal);
  if (cycle !== null) {
    throw new GroundingError(`task dependencies contain a cycle: ${cycle.join(' -> ')}`, {
      spec_id: spec.id,
      cycle,
    });
  }

  // Every acceptance criterion must be somebody's job, or something a human approved
  // will not be built.
  const verified = new Set(proposal.tasks.flatMap((t) => t.verifies));
  const uncovered = [...knownCriteria].filter((id) => !verified.has(id));
  if (uncovered.length > 0) {
    log.warn({ uncovered }, 'tasks leave acceptance criteria uncovered');
    throw new GroundingError(
      `no task verifies acceptance criterion/criteria: ${uncovered.join(', ')}`,
      { spec_id: spec.id, uncovered },
    );
  }

  if (spec.mode === 'brownfield') {
    const violations = checkAllCitations(
      evidence,
      proposal.tasks.map((task, i) => ({
        location: `tasks[${String(i)}].source_refs`,
        refs: task.source_refs,
      })),
    );
    if (violations.length > 0) {
      throw new GroundingError(
        `tasks cite evidence that is not verified: ${describeViolations(violations)}`,
        { spec_id: spec.id, violations },
      );
    }
  }

  // --- Write, materialise rows, transition, then trace. -------------------

  const { artifact } = writeArtifact(db, {
    specId: spec.id,
    kind: 'tasks',
    payload: proposal,
    contentMd: renderTasks(spec.title, proposal),
    actor: AGENT,
    idempotencyKey: input.idempotencyKey,
    correlationId,
  });

  const tasksInserted = syncTasks(db, spec.id, proposal);

  const current = requireSpecById(db, spec.id);
  const after =
    current.status === 'DESIGN_APPROVED'
      ? transition(db, {
          specId: spec.id,
          from: 'DESIGN_APPROVED',
          to: 'TASKS_GENERATED',
          actor: ORCHESTRATOR,
          expectedVersion: current.version,
          reason: `The Task Agent produced ${String(proposal.tasks.length)} task(s).`,
          payload: {
            task_count: proposal.tasks.length,
            artifact_version: artifact.version,
            content_hash: artifact.contentHash,
          },
          correlationId,
        }).spec
      : current;

  // The trace matrix can only be complete once tasks exist, so it is computed here.
  //
  // The pack is installed first. Without this a database that was migrated but never
  // seeded had no pack, `installedPackVersion` was undefined, and the whole trace was
  // skipped without a word.
  ensurePackInstalled(db);
  const packVersion = installedPackVersion(db);
  if (packVersion !== undefined) {
    const rules = applicableRules({
      title: spec.title,
      description: spec.description,
      requirementText: requirements.requirements.map((r) => `${r.ears_statement} ${r.rationale}`),
    });

    const violations = detectSupersededTerms([
      ...design.sections.map((section, i) => ({
        location: `design.sections[${String(i)}].body`,
        text: section.body,
      })),
      ...proposal.tasks.map((task, i) => ({
        location: `tasks[${String(i)}].description`,
        text: task.description,
      })),
    ]);

    const coverage = buildTraceMatrix({
      packVersion,
      applicableRules: rules,
      requirements,
      design,
      tasks: proposal,
      violations,
    });

    saveTraces(db, spec.id, packVersion, coverage.traces);

    log.info(
      {
        applicable_rules: coverage.applicable_rules,
        traced_to_task: coverage.traced_to_task,
        coverage_rate: coverage.coverage_rate,
        violations: violations.length,
      },
      'compliance trace matrix computed',
    );
  }

  log.info(
    { tasks: proposal.tasks.length, inserted: tasksInserted, artifact_version: artifact.version },
    'tasks generated',
  );

  return { spec: after, artifact, proposal, tasksInserted, costUsd };
}
