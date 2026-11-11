import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The derived thread.
 *
 * The workspace has no message table: the conversation is a rendering of the audit log,
 * the artifacts and the clarifications. That is the property worth testing, because it
 * is what makes the chat trustworthy — a message cannot be edited or invented, since
 * every item has to correspond to a durable row.
 *
 * So these tests drive a spec through the real gates and then assert that the thread
 * shows exactly what happened, in the order it happened.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-thread-'));
process.env['SDD_DB_PATH'] = join(dir, 'thread.db');
process.env['SDD_RUN_COST_CAP_USD'] = '2.00';

const { getDb, closeDb } = await import('@agentforge/db');
const {
  askClarifications,
  answerClarifications,
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  transition,
  writeArtifact,
} = await import('@agentforge/orchestrator');
const { renderRequirements } = await import('@agentforge/agents');
const contract = await import('@agentforge/contract');
const { buildThread } = await import('@/lib/thread');

const HUMAN = { id: 'reviewer@example.com', type: 'human' } as const;
const AGENT = { id: 'requirement-agent', type: 'agent' } as const;
const ORCHESTRATOR = { id: 'orchestrator', type: 'orchestrator' } as const;

const PROPOSAL = contract.RequirementsProposalSchema.parse({
  feature_summary: 'Export invoices as GST JSON.',
  requirements: [
    {
      id: 'REQ-001',
      ears_pattern: 'event_driven',
      ears_statement: 'When a user exports an invoice, the system shall emit GST JSON.',
      rationale: 'Needed for IRP upload.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-001',
          given: 'a finalised invoice',
          when: 'the user exports it',
          then: 'a GST payload is produced',
          compliance_rule_key: 'GST-001',
        },
        {
          id: 'AC-002',
          given: 'an invoice with no GSTIN',
          when: 'the user exports it',
          then: 'the export is refused',
          compliance_rule_key: null,
        },
      ],
      source_refs: [],
      compliance_refs: ['GST-001'],
    },
  ],
  clarification_questions: [],
  non_goals: [],
});

function version(specId: string): number {
  const spec = getSpec(getDb(), specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec.version;
}

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildThread', () => {
  it('opens with the feature request as the user turn', () => {
    const spec = createSpec(getDb(), {
      title: 'GST export',
      description: 'Export a finalised invoice as GST e-invoice JSON.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    const items = buildThread(getDb(), spec.id);

    expect(items[0]).toMatchObject({
      type: 'request',
      text: 'Export a finalised invoice as GST e-invoice JSON.',
      mode: 'greenfield',
    });

    // The spec's creation is the request; showing it again as a transition would
    // duplicate the first thing in the thread.
    expect(items.filter((item) => item.type === 'activity')).toHaveLength(0);
  });

  it('shows questions and the answers given to them', () => {
    const spec = createSpec(getDb(), {
      title: 'Needs clarifying',
      description: 'Ambiguous on purpose.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    askClarifications(getDb(), spec.id, [
      {
        question: 'Should credit notes be covered?',
        why_it_matters: 'They double the validation surface.',
        options: ['Invoices only', 'Both'],
      },
    ]);

    const asked = buildThread(getDb(), spec.id).find((item) => item.type === 'question');
    expect(asked).toMatchObject({
      question: 'Should credit notes be covered?',
      answer: null,
    });

    answerClarifications(
      getDb(),
      spec.id,
      [{ clarificationId: (asked as { id: string }).id, answer: 'Invoices only' }],
      HUMAN,
    );

    const answered = buildThread(getDb(), spec.id).find((item) => item.type === 'question');
    expect(answered).toMatchObject({
      answer: 'Invoices only',
      answeredBy: HUMAN.id,
    });
  });

  it('summarises an artifact with counts taken from its validated payload', () => {
    const spec = createSpec(getDb(), {
      title: 'With an artifact',
      description: 'Produces requirements.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    writeArtifact(getDb(), {
      specId: spec.id,
      kind: 'requirements',
      payload: PROPOSAL,
      contentMd: renderRequirements(spec.title, PROPOSAL),
      actor: AGENT,
      idempotencyKey: 'thread-artifact-1',
    });

    const card = buildThread(getDb(), spec.id).find((item) => item.type === 'artifact');

    // Counts come from the JSON, not the markdown, so the card cannot disagree with the
    // document it links to.
    expect(card).toMatchObject({
      kind: 'requirements',
      version: 1,
      createdBy: AGENT.id,
      facts: ['1 requirement', '2 acceptance criteria', '1 compliance rule'],
    });
  });

  it('records a decision with the hash it bound to', () => {
    const spec = createSpec(getDb(), {
      title: 'Decided',
      description: 'Gets approved.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    writeArtifact(getDb(), {
      specId: spec.id,
      kind: 'requirements',
      payload: PROPOSAL,
      contentMd: renderRequirements(spec.title, PROPOSAL),
      actor: AGENT,
      idempotencyKey: 'thread-decision-1',
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_APPROVAL',
      actor: ORCHESTRATOR,
      expectedVersion: version(spec.id),
    });

    const head = getHeadArtifact(getDb(), spec.id, 'requirements');
    if (head === undefined) throw new Error('no artifact');

    decideArtifact(getDb(), {
      specId: spec.id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'approve',
      comment: 'Criteria are testable.',
      actor: HUMAN,
      expectedVersion: version(spec.id),
    });

    const decision = buildThread(getDb(), spec.id).find((item) => item.type === 'decision');

    expect(decision).toMatchObject({
      decision: 'approve',
      actor: HUMAN.id,
      comment: 'Criteria are testable.',
      contentHash: head.contentHash,
    });
  });

  it('orders the artifact before the transition it caused', () => {
    // Both commit inside one transaction and can share a millisecond, so sorting on the
    // timestamp alone is not enough — the cause has to come before the effect or the
    // thread reads backwards.
    const spec = createSpec(getDb(), {
      title: 'Ordering',
      description: 'Artifact then transition.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    writeArtifact(getDb(), {
      specId: spec.id,
      kind: 'requirements',
      payload: PROPOSAL,
      contentMd: renderRequirements(spec.title, PROPOSAL),
      actor: AGENT,
      idempotencyKey: 'thread-order-1',
    });

    transition(getDb(), {
      specId: spec.id,
      from: 'REQ_DRAFTING',
      to: 'REQ_AWAITING_APPROVAL',
      actor: ORCHESTRATOR,
      expectedVersion: version(spec.id),
    });

    const items = buildThread(getDb(), spec.id);
    const artifactAt = items.findIndex((item) => item.type === 'artifact');
    const awaitingAt = items.findIndex(
      (item) => item.type === 'activity' && item.toState === 'REQ_AWAITING_APPROVAL',
    );

    expect(artifactAt).toBeGreaterThanOrEqual(0);
    expect(awaitingAt).toBeGreaterThan(artifactAt);
  });

  it('returns nothing for a spec that does not exist', () => {
    expect(buildThread(getDb(), 'spec_does_not_exist')).toEqual([]);
  });
});
