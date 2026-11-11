import {
  ContextBundleSchema,
  type DesignProposal,
  DesignProposalSchema,
  GroundingError,
  RequirementsProposalSchema,
  TransitionError,
} from '@agentforge/contract';
import { type Db, parseJsonColumn } from '@agentforge/db';
import { complete } from '@agentforge/llm';
import {
  findArtifactByIdempotencyKey,
  getHeadArtifact,
  listEvidence,
  newCorrelationId,
  requireSpecById,
  runLogger,
  transition,
  writeArtifact,
  type Actor,
  type ArtifactRow,
  type SpecRow,
} from '@agentforge/orchestrator';
import { checkAllCitations, describeViolations } from './citations.ts';
import { renderDesign } from './render/index.ts';
import {
  approvedArtifactSection,
  contextSummarySection,
  evidenceSection,
  requestSection,
  skillSection,
} from './sections.ts';

/**
 * The Design Agent.
 *
 * Consumes the *approved* requirements and produces a design in which every claim
 * about existing code carries a citation that resolves to verified evidence.
 *
 * The agent never sees unapproved requirements: it reads the head requirements
 * artifact, and the orchestrator has already refused to enter `DESIGN_DRAFTING` unless
 * that version is still the one a human approved. So the design is, by construction,
 * designed against what was signed off.
 */

const AGENT: Actor = { id: 'design-agent', type: 'agent' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

export interface DraftDesignInput {
  readonly specId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

export interface DraftDesignResult {
  readonly spec: SpecRow;
  readonly artifact: ArtifactRow;
  readonly proposal: DesignProposal;
  readonly costUsd: number;
}

export async function draftDesign(db: Db, input: DraftDesignInput): Promise<DraftDesignResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const log = runLogger(correlationId, { spec_id: input.specId, agent: 'design' });

  // Replayable for the same reason as the requirements draft: a retry of a call that
  // already landed must return its artifact, not fail a state guard.
  const replay = findArtifactByIdempotencyKey(db, input.specId, 'design', input.idempotencyKey);
  if (replay !== undefined) {
    const spec = requireSpecById(db, input.specId);
    log.info({ artifact_version: replay.version }, 'design draft replayed');
    return {
      spec,
      artifact: replay,
      proposal: parseJsonColumn(
        DesignProposalSchema,
        replay.contentJson,
        `artifact_versions.content_json (design v${String(replay.version)})`,
      ),
      costUsd: 0,
    };
  }

  const spec = requireSpecById(db, input.specId);
  if (spec.status !== 'DESIGN_DRAFTING') {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `a design may only be drafted while the spec is in DESIGN_DRAFTING; it is in ${spec.status}`,
      { spec_id: spec.id, actual_state: spec.status },
    );
  }

  const requirementsArtifact = getHeadArtifact(db, spec.id, 'requirements');
  if (requirementsArtifact === undefined) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      'no requirements artifact exists to design against',
      { spec_id: spec.id },
    );
  }

  // Validated on read: a JSON column is a trust boundary like any other.
  const requirements = parseJsonColumn(
    RequirementsProposalSchema,
    requirementsArtifact.contentJson,
    `artifact_versions.content_json (requirements v${String(requirementsArtifact.version)})`,
  );

  const evidence = listEvidence(db, spec.id);

  // The context summary, when a scan has run, orients the design in the existing code.
  const contextArtifact = getHeadArtifact(db, spec.id, 'context');
  const bundle =
    contextArtifact === undefined
      ? null
      : parseJsonColumn(
          ContextBundleSchema,
          contextArtifact.contentJson,
          `artifact_versions.content_json (context v${String(contextArtifact.version)})`,
        );

  const { output: proposal, costUsd } = await complete({
    db,
    specId: spec.id,
    stage: 'design',
    correlationId,
    schema: DesignProposalSchema,
    schemaName: 'design_proposal',
    sections: [
      skillSection('sdd-design'),
      contextSummarySection(bundle?.summary ?? null, bundle?.open_questions ?? []),
      evidenceSection(evidence),
      approvedArtifactSection('requirements', requirementsArtifact.contentMd),
      requestSection(spec),
    ],
    userMessage:
      'Produce the design for the approved requirements above. Every claim about code ' +
      'that already exists must carry a citation copied from the verified evidence.',
  });

  // Every `must` requirement has to be covered by at least one section, or something
  // the reviewer approved will not get built. Checked here rather than left to the
  // trace matrix, so the gap is caught before the artifact exists.
  const covered = new Set(proposal.sections.flatMap((s) => s.requirement_ids));
  const uncovered = requirements.requirements
    .filter((r) => r.priority === 'must' && !covered.has(r.id))
    .map((r) => r.id);

  if (uncovered.length > 0) {
    log.warn({ uncovered }, 'design leaves must-have requirements uncovered');
    throw new GroundingError(
      `the design covers no section for required requirement(s): ${uncovered.join(', ')}`,
      { spec_id: spec.id, uncovered },
    );
  }

  // Sections may only reference requirements that exist. A reference to REQ-009 when
  // there are six requirements would silently corrupt the trace matrix.
  const known = new Set(requirements.requirements.map((r) => r.id));
  const unknown = [...covered].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new GroundingError(
      `the design references requirement id(s) that do not exist: ${unknown.join(', ')}`,
      { spec_id: spec.id, unknown },
    );
  }

  if (spec.mode === 'brownfield') {
    const violations = checkAllCitations(
      evidence,
      proposal.sections.map((section, i) => ({
        location: `sections[${String(i)}].source_refs`,
        refs: section.source_refs,
      })),
    );

    if (violations.length > 0) {
      log.warn({ violations }, 'design cited unverified evidence');
      throw new GroundingError(
        `the design cites evidence that is not verified: ${describeViolations(violations)}`,
        { spec_id: spec.id, violations },
      );
    }
  }

  const { artifact, replayed } = writeArtifact(db, {
    specId: spec.id,
    kind: 'design',
    payload: proposal,
    contentMd: renderDesign(spec.title, proposal),
    actor: AGENT,
    idempotencyKey: input.idempotencyKey,
    correlationId,
  });

  const current = requireSpecById(db, spec.id);
  const after =
    current.status === 'DESIGN_DRAFTING'
      ? transition(db, {
          specId: spec.id,
          from: 'DESIGN_DRAFTING',
          to: 'DESIGN_AWAITING_APPROVAL',
          actor: ORCHESTRATOR,
          expectedVersion: current.version,
          reason: `The Design Agent proposed ${String(proposal.sections.length)} section(s).`,
          payload: {
            section_count: proposal.sections.length,
            artifact_version: artifact.version,
            content_hash: artifact.contentHash,
          },
          correlationId,
        }).spec
      : current;

  log.info(
    { sections: proposal.sections.length, artifact_version: artifact.version, replayed },
    'design proposed',
  );

  return { spec: after, artifact, proposal, costUsd };
}
