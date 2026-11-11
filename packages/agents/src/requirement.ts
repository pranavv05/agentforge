import {
  GroundingError,
  type RequirementsProposal,
  RequirementsProposalSchema,
  TransitionError,
} from '@agentforge/contract';
import { parseJsonColumn, type Db } from '@agentforge/db';
import { complete } from '@agentforge/llm';
import {
  askClarifications,
  findArtifactByIdempotencyKey,
  listClarifications,
  listEvidence,
  newCorrelationId,
  requireSpecById,
  runLogger,
  transition,
  writeArtifact,
  type Actor,
  type ArtifactRow,
  type ClarificationView,
  type SpecRow,
} from '@agentforge/orchestrator';
import { checkAllCitations, describeViolations } from './citations.ts';
import { renderRequirements } from './render/index.ts';
import {
  clarificationSection,
  contextSummarySection,
  evidenceSection,
  requestSection,
  roundBudgetSection,
  skillSection,
} from './sections.ts';

/**
 * The Requirement Agent.
 *
 * Drafts requirements, or asks clarifying questions when an answer would change them.
 *
 * Two governance properties are structural here rather than incidental:
 *
 * - the agent writes the artifact as an `agent` actor and the *orchestrator* performs
 *   the transition. An agent cannot move its own work toward approval;
 * - the whole call is idempotent on `idempotencyKey`, so a retried draft returns the
 *   existing version instead of stacking a duplicate. This is the hazard the source
 *   document flags for framework resume semantics, avoided by design.
 */

/** Clarification rounds a spec may spend. Two is the documented cap. */
export const MAX_CLARIFICATION_ROUNDS = 2;

const AGENT: Actor = { id: 'requirement-agent', type: 'agent' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

export interface DraftRequirementsInput {
  readonly specId: string;
  /** Returned unchanged on a retry, so a duplicate call cannot create a second version. */
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

export type DraftRequirementsResult =
  | {
      readonly outcome: 'proposed';
      readonly spec: SpecRow;
      readonly artifact: ArtifactRow;
      readonly proposal: RequirementsProposal;
      readonly costUsd: number;
    }
  | {
      readonly outcome: 'clarification_requested';
      readonly spec: SpecRow;
      readonly clarifications: readonly ClarificationView[];
      readonly costUsd: number;
    };

/** How many rounds of questions have already been asked. */
function roundsUsed(clarifications: readonly ClarificationView[]): number {
  return clarifications.reduce((max, c) => Math.max(max, c.round), 0);
}

export async function draftRequirements(
  db: Db,
  input: DraftRequirementsInput,
): Promise<DraftRequirementsResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const log = runLogger(correlationId, { spec_id: input.specId, agent: 'requirement' });

  // A call that already succeeded is replayable even though the spec has since moved
  // past REQ_DRAFTING: a client timeout and retry must not surface as a precondition
  // failure on work that actually completed. Checked before the state guard, and
  // without a model call.
  const replay = findArtifactByIdempotencyKey(
    db,
    input.specId,
    'requirements',
    input.idempotencyKey,
  );
  if (replay !== undefined) {
    const spec = requireSpecById(db, input.specId);
    log.info({ artifact_version: replay.version }, 'requirements draft replayed');
    return {
      outcome: 'proposed',
      spec,
      artifact: replay,
      proposal: parseJsonColumn(
        RequirementsProposalSchema,
        replay.contentJson,
        `artifact_versions.content_json (requirements v${String(replay.version)})`,
      ),
      costUsd: 0,
    };
  }

  const spec = requireSpecById(db, input.specId);
  if (spec.status !== 'REQ_DRAFTING') {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `requirements may only be drafted while the spec is in REQ_DRAFTING; it is in ${spec.status}`,
      { spec_id: spec.id, actual_state: spec.status },
    );
  }

  const evidence = listEvidence(db, spec.id);
  const clarifications = listClarifications(db, spec.id);
  const used = roundsUsed(clarifications);

  const { output: proposal, costUsd } = await complete({
    db,
    specId: spec.id,
    stage: 'requirements',
    correlationId,
    schema: RequirementsProposalSchema,
    schemaName: 'requirements_proposal',
    sections: [
      skillSection('sdd-requirements'),
      contextSummarySection(null, []),
      evidenceSection(evidence),
      requestSection(spec),
      clarificationSection(clarifications),
      roundBudgetSection(used, MAX_CLARIFICATION_ROUNDS),
    ],
    userMessage:
      used >= MAX_CLARIFICATION_ROUNDS
        ? 'Propose the requirements now. Your clarification budget is spent, so state any ' +
          'remaining uncertainty as an explicit assumption rather than asking.'
        : 'Produce the requirements for this feature, or ask clarifying questions if an ' +
          'answer would change them.',
  });

  // Asking is only an option while budget remains, and only when nothing was proposed.
  // A proposal that also carries questions is treated as a proposal: the questions are
  // advisory at that point, and stalling an otherwise complete draft to ask them would
  // cost the reviewer a round for nothing.
  const wantsClarification =
    proposal.requirements.length === 0 && proposal.clarification_questions.length > 0;

  if (wantsClarification) {
    if (used >= MAX_CLARIFICATION_ROUNDS) {
      throw new GroundingError(
        `the agent asked for a ${String(used + 1)}th clarification round, but the cap is ` +
          `${String(MAX_CLARIFICATION_ROUNDS)} and it proposed no requirements`,
        { spec_id: spec.id, rounds_used: used },
      );
    }

    askClarifications(db, spec.id, proposal.clarification_questions);
    const after = transition(db, {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_CLARIFICATION',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
      reason: `The Requirement Agent asked ${String(proposal.clarification_questions.length)} question(s).`,
      payload: { round: used + 1, questions: proposal.clarification_questions.length },
      correlationId,
    });

    log.info({ questions: proposal.clarification_questions.length }, 'clarification requested');

    return {
      outcome: 'clarification_requested',
      spec: after.spec,
      clarifications: listClarifications(db, spec.id).filter((c) => c.answer === null),
      costUsd,
    };
  }

  if (proposal.requirements.length === 0) {
    throw new GroundingError('the agent proposed no requirements and asked no questions', {
      spec_id: spec.id,
    });
  }

  // Grounding: for a brownfield spec every citation must resolve to verified evidence.
  // Checked before the artifact is written, so an ungrounded document never exists.
  if (spec.mode === 'brownfield') {
    const violations = checkAllCitations(
      evidence,
      proposal.requirements.map((req, i) => ({
        location: `requirements[${String(i)}].source_refs`,
        refs: req.source_refs,
      })),
    );

    if (violations.length > 0) {
      log.warn({ violations }, 'requirements cited unverified evidence');
      throw new GroundingError(
        `the proposal cites evidence that is not verified: ${describeViolations(violations)}`,
        { spec_id: spec.id, violations },
      );
    }
  }

  const { artifact, replayed } = writeArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    payload: proposal,
    contentMd: renderRequirements(spec.title, proposal),
    actor: AGENT,
    idempotencyKey: input.idempotencyKey,
    correlationId,
  });

  // A replay has already advanced the spec, so transitioning again would be a conflict.
  const current = requireSpecById(db, spec.id);
  const after =
    current.status === 'REQ_DRAFTING'
      ? transition(db, {
          specId: spec.id,
          from: 'REQ_DRAFTING',
          to: 'REQ_AWAITING_APPROVAL',
          actor: ORCHESTRATOR,
          expectedVersion: current.version,
          reason: `The Requirement Agent proposed ${String(proposal.requirements.length)} requirement(s).`,
          payload: {
            requirement_count: proposal.requirements.length,
            artifact_version: artifact.version,
            content_hash: artifact.contentHash,
          },
          correlationId,
        }).spec
      : current;

  log.info(
    {
      requirements: proposal.requirements.length,
      artifact_version: artifact.version,
      replayed,
    },
    'requirements proposed',
  );

  return { outcome: 'proposed', spec: after, artifact, proposal, costUsd };
}
