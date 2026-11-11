import {
  ARTIFACT_KINDS,
  DesignProposalSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
  type ActorType,
  type ApprovalDecision,
  type ArtifactKind,
  type SpecMode,
  type SpecState,
} from '@agentforge/contract';
import { parseJsonColumn, type Db } from '@agentforge/db';
import {
  getSpec,
  listApprovals,
  listArtifactVersions,
  listAuditEntries,
  listClarifications,
} from '@agentforge/orchestrator';

/**
 * The conversation, derived from the record.
 *
 * There is no message table, and adding one would have been the wrong move. Everything a
 * thread needs already exists as durable rows: the feature request is the spec, the
 * agent's turns are audit entries, its questions are clarifications, its output is
 * artifact versions, and the human's decisions are approvals.
 *
 * So the chat is a *rendering of the audit trail* rather than a parallel history beside
 * it. That has a property worth keeping: the conversation cannot drift from the record,
 * because it is the record. A message cannot be edited or deleted — the underlying rows
 * are append-only at the database level — and nothing can appear in the thread that did
 * not actually happen.
 *
 * It also means a thread survives a process restart, and a run driven from the CLI shows
 * up in the UI without either side knowing about the other.
 */

export interface ThreadRequest {
  readonly type: 'request';
  readonly at: string;
  readonly text: string;
  readonly mode: SpecMode;
  readonly repoPath: string | null;
}

export interface ThreadActivity {
  readonly type: 'activity';
  readonly at: string;
  readonly fromState: SpecState | null;
  readonly toState: SpecState;
  readonly actor: string;
  readonly actorType: ActorType;
  readonly reason: string | null;
}

export interface ThreadQuestion {
  readonly type: 'question';
  readonly at: string;
  readonly id: string;
  readonly question: string;
  readonly whyItMatters: string;
  readonly options: readonly string[];
  readonly answer: string | null;
  readonly answeredBy: string | null;
  readonly answeredAt: string | null;
}

export interface ThreadArtifact {
  readonly type: 'artifact';
  readonly at: string;
  readonly kind: ArtifactKind;
  readonly version: number;
  readonly contentHash: string;
  readonly createdBy: string;
  /** Short factual counts for the card, e.g. "16 requirements · 21 criteria". */
  readonly facts: readonly string[];
}

export interface ThreadDecision {
  readonly type: 'decision';
  readonly at: string;
  readonly decision: ApprovalDecision;
  readonly actor: string;
  readonly comment: string | null;
  readonly contentHash: string;
  readonly artifactKind: ArtifactKind;
}

export type ThreadItem =
  ThreadRequest | ThreadActivity | ThreadQuestion | ThreadArtifact | ThreadDecision;

/**
 * Counts worth putting on an artifact card.
 *
 * Read from the validated JSON rather than the markdown, so the card cannot disagree
 * with the document. Returns nothing rather than guessing when the payload is a kind we
 * have no summary for.
 */
function factsFor(kind: ArtifactKind, contentJson: string, hash: string): readonly string[] {
  const where = `artifact_versions.content_json (${kind} ${hash.slice(0, 8)})`;

  if (kind === 'requirements') {
    const parsed = parseJsonColumn(RequirementsProposalSchema, contentJson, where);
    const criteria = parsed.requirements.reduce(
      (total, requirement) => total + requirement.acceptance_criteria.length,
      0,
    );
    const rules = new Set(parsed.requirements.flatMap((r) => r.compliance_refs));

    return [
      `${String(parsed.requirements.length)} requirement${parsed.requirements.length === 1 ? '' : 's'}`,
      `${String(criteria)} acceptance criteri${criteria === 1 ? 'on' : 'a'}`,
      ...(rules.size > 0
        ? [`${String(rules.size)} compliance rule${rules.size === 1 ? '' : 's'}`]
        : []),
    ];
  }

  if (kind === 'design') {
    const parsed = parseJsonColumn(DesignProposalSchema, contentJson, where);
    return [
      `${String(parsed.sections.length)} section${parsed.sections.length === 1 ? '' : 's'}`,
      `${String(parsed.decisions.length)} decision${parsed.decisions.length === 1 ? '' : 's'}`,
      `${String(parsed.risks.length)} risk${parsed.risks.length === 1 ? '' : 's'}`,
    ];
  }

  if (kind === 'tasks') {
    const parsed = parseJsonColumn(TasksProposalSchema, contentJson, where);
    return [`${String(parsed.tasks.length)} task${parsed.tasks.length === 1 ? '' : 's'}`];
  }

  // `context` carries a bundle whose headline number is the unverified-claim rate, and
  // that is already shown on its own panel. No card facts rather than invented ones.
  return [];
}

/** Builds the thread for one spec, oldest first. */
export function buildThread(db: Db, specId: string): readonly ThreadItem[] {
  const spec = getSpec(db, specId);
  if (spec === undefined) return [];

  const items: ThreadItem[] = [
    {
      type: 'request',
      at: spec.createdAt,
      text: spec.description,
      mode: spec.mode,
      repoPath: spec.repoPath,
    },
  ];

  // The spec's own creation is already the request above; showing it again as a
  // transition would duplicate the first thing in the thread.
  for (const entry of listAuditEntries(db, specId)) {
    if (entry.fromState === null) continue;

    items.push({
      type: 'activity',
      at: entry.createdAt,
      fromState: entry.fromState,
      toState: entry.toState,
      actor: entry.actor,
      actorType: entry.actorType,
      reason: entry.reason,
    });
  }

  for (const clarification of listClarifications(db, specId)) {
    items.push({
      type: 'question',
      at: clarification.created_at,
      id: clarification.id,
      question: clarification.question,
      whyItMatters: clarification.why_it_matters,
      options: clarification.options,
      answer: clarification.answer,
      answeredBy: clarification.answered_by,
      answeredAt: clarification.answered_at,
    });
  }

  for (const kind of ARTIFACT_KINDS) {
    for (const artifact of listArtifactVersions(db, specId, kind)) {
      items.push({
        type: 'artifact',
        at: artifact.createdAt,
        kind,
        version: artifact.version,
        contentHash: artifact.contentHash,
        createdBy: artifact.createdBy,
        facts: factsFor(kind, artifact.contentJson, artifact.contentHash),
      });
    }
  }

  for (const approval of listApprovals(db, specId)) {
    items.push({
      type: 'decision',
      at: approval.createdAt,
      decision: approval.decision,
      actor: approval.actor,
      comment: approval.comment,
      contentHash: approval.contentHash,
      artifactKind: approval.artifactKind,
    });
  }

  // Stable ordering: timestamps can collide inside one transaction — an artifact write
  // and the transition that followed it share a millisecond — so ties fall back to a
  // fixed rank that puts the cause before the effect.
  const rank: Record<ThreadItem['type'], number> = {
    request: 0,
    question: 1,
    artifact: 2,
    activity: 3,
    decision: 4,
  };

  return items.sort((a, b) => a.at.localeCompare(b.at) || rank[a.type] - rank[b.type]);
}
