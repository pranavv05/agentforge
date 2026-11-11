/**
 * Seeds fixture data.
 *
 * This script exists for one reason: the frontend track must be buildable before a
 * single model call works. It drives three specs to different points in the real state
 * machine — using only public orchestrator calls, never direct SQL — so every screen
 * the juniors build has realistic data on day one:
 *
 * - **Spec A** sits at the requirements approval gate with *two* versions, so the
 *   artifact viewer, the version picker and the diff view all have something to show,
 *   plus one answered and one open clarification.
 * - **Spec B** is brownfield and `CONTEXT_READY`, carrying both verified and
 *   unverified evidence so the verified/unverified badges and the unverified-claim
 *   rate are visible.
 * - **Spec C** is driven all the way to `READY_FOR_IMPLEMENTATION` with task rows and
 *   recorded LLM calls, so the task list, audit timeline and cost meter are populated.
 *
 * Re-runnable: it clears the three fixture specs first. It refuses to touch anything
 * else.
 */
import {
  DesignProposalSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
  type ClarificationQuestion,
} from '@agentforge/contract';
import { createDb, resolveDbPath, schema } from '@agentforge/db';
import { renderDesign, renderRequirements, renderTasks } from '@agentforge/agents';
import {
  answerClarifications,
  askClarifications,
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  listClarifications,
  recordLlmCall,
  replaceEvidence,
  syncTasks,
  transition,
  writeArtifact,
  type Actor,
} from '@agentforge/orchestrator';
import { eq, like } from 'drizzle-orm';

const REVIEWER: Actor = { id: 'reviewer@agentforge.local', type: 'human' };
const REQ_AGENT: Actor = { id: 'requirement-agent', type: 'agent' };
const DESIGN_AGENT: Actor = { id: 'design-agent', type: 'agent' };
const TASK_AGENT: Actor = { id: 'task-agent', type: 'agent' };
const SYSTEM: Actor = { id: 'orchestrator', type: 'orchestrator' };

const FIXTURE_MARKER = '[fixture]';

const db = createDb();

/** Removes previously seeded fixtures so the script is safely re-runnable. */
function clearFixtures(): void {
  const existing = db
    .select({ id: schema.specs.id, title: schema.specs.title })
    .from(schema.specs)
    .where(like(schema.specs.title, `${FIXTURE_MARKER}%`))
    .all();

  for (const spec of existing) {
    // audit_log and approvals cannot be deleted row by row — their triggers refuse it
    // while the parent spec exists. Deleting the spec is the only sanctioned route:
    // the cascade removes the whole history together, which is a wholesale, obvious
    // act rather than a selective edit. See migration 0002.
    db.delete(schema.specs).where(eq(schema.specs.id, spec.id)).run();
  }

  if (existing.length > 0) {
    console.log(`cleared ${String(existing.length)} existing fixture spec(s)`);
  }
}

const requirementsV1 = RequirementsProposalSchema.parse({
  feature_summary:
    'Let a small business export a finalised invoice as GST e-invoice JSON, ready for upload to the IRP.',
  requirements: [
    {
      id: 'REQ-001',
      ears_pattern: 'event_driven',
      ears_statement:
        'When a user exports a finalised invoice, the system shall produce a GST e-invoice JSON payload.',
      rationale: 'The payload is the input to IRN generation; without it nothing can be filed.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-001',
          given: 'a finalised invoice with a registered buyer',
          when: 'the user exports it',
          then: 'every mandatory GST field is present in the payload',
          compliance_rule_key: 'GST-001',
        },
      ],
      source_refs: [],
      compliance_refs: ['GST-001'],
    },
  ],
  clarification_questions: [],
  non_goals: ['Live IRP submission', 'Credit and debit notes'],
});

/** v2 adds the TDS requirement a reviewer asked for, so the diff view has real content. */
const requirementsV2 = RequirementsProposalSchema.parse({
  ...requirementsV1,
  feature_summary:
    'Let a small business export a finalised invoice as GST e-invoice JSON, ready for upload to the IRP, ' +
    'rejecting any deduction that cites a superseded Income-tax Act 1961 section.',
  requirements: [
    ...requirementsV1.requirements,
    {
      id: 'REQ-002',
      ears_pattern: 'unwanted_behaviour',
      ears_statement:
        'If a deduction cites a section of the Income-tax Act 1961, then the system shall refuse the export and name the Section 393 equivalent.',
      rationale:
        'The 194-series ceased to exist on 1 April 2026; each rate is now a row in the Section 393 table.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-002',
          given: 'a deduction citing Section 194J',
          when: 'the invoice is exported',
          then: 'the export is refused and Section 393 (professional fees, 10%, code 1027) is suggested',
          compliance_rule_key: 'TDS-001',
        },
      ],
      source_refs: [],
      compliance_refs: ['TDS-001'],
    },
  ],
});

const CLARIFICATIONS: readonly ClarificationQuestion[] = [
  {
    question: 'Should the export cover credit notes as well as invoices?',
    why_it_matters:
      'Credit notes carry a different mandatory field set, which roughly doubles the validation surface.',
    options: ['Invoices only', 'Invoices and credit notes'],
  },
  {
    question: 'Which GST e-invoice schema version should the payload target?',
    why_it_matters: 'Field names and cardinality differ between published schema versions.',
    options: ['1.1', '1.03', 'Latest published'],
  },
];

/** Spec A: parked at the requirements gate, two versions, one open clarification. */
function seedSpecA(): string {
  const spec = createSpec(db, {
    title: `${FIXTURE_MARKER} GST invoice export`,
    description:
      'Hum chaahte hain ki invoice ko GST e-invoice JSON format mein export kiya ja sake. ' +
      '(Accepted as Hinglish input; the spec itself is produced in English.)',
    mode: 'greenfield',
    repo_path: null,
    actor: REVIEWER,
  });

  const v = () => {
    const s = getSpec(db, spec.id);
    if (s === undefined) throw new Error('fixture spec vanished');
    return s;
  };

  transition(db, {
    specId: spec.id,
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  // Round one: the agent asks rather than guessing.
  askClarifications(db, spec.id, CLARIFICATIONS);
  const asked = listClarifications(db, spec.id);
  const first = asked[0];
  if (first === undefined) throw new Error('expected clarifications');
  answerClarifications(
    db,
    spec.id,
    [{ clarificationId: first.id, answer: 'Invoices only for now.' }],
    REVIEWER,
  );

  // v1, reviewed and sent back for changes.
  writeArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    payload: requirementsV1,
    contentMd: renderRequirements('GST invoice export', requirementsV1),
    actor: REQ_AGENT,
  });
  transition(db, {
    specId: spec.id,
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  const head1 = getHeadArtifact(db, spec.id, 'requirements');
  if (head1 === undefined) throw new Error('expected requirements v1');
  decideArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    contentHash: head1.contentHash,
    decision: 'request_changes',
    comment: 'Add the TDS case: a design citing Section 194J must be refused.',
    actor: REVIEWER,
    expectedVersion: v().version,
  });

  // v2 addresses the comment and is waiting for a decision.
  writeArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    payload: requirementsV2,
    contentMd: renderRequirements('GST invoice export', requirementsV2),
    actor: REQ_AGENT,
  });
  transition(db, {
    specId: spec.id,
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  recordLlmCall(db, {
    specId: spec.id,
    stage: 'requirements',
    model: 'claude-haiku-5-5',
    usage: {
      inputTokens: 12_400,
      outputTokens: 2_900,
      cacheReadInputTokens: 38_000,
      cacheCreationInputTokens: 9_500,
    },
    latencyMs: 8_140,
    fromCassette: false,
    correlationId: 'run_seed_a',
  });

  return spec.id;
}

/** Spec B: brownfield, context scanned, with a deliberately mixed verification result. */
function seedSpecB(): string {
  const spec = createSpec(db, {
    title: `${FIXTURE_MARKER} Add TDS deduction to payouts`,
    description:
      'Deduct TDS at the Section 393 rate when paying a vendor, and record the payment code used.',
    mode: 'brownfield',
    repo_path: process.cwd(),
    actor: REVIEWER,
  });

  const v = () => {
    const s = getSpec(db, spec.id);
    if (s === undefined) throw new Error('fixture spec vanished');
    return s;
  };

  transition(db, {
    specId: spec.id,
    from: 'CREATED',
    to: 'CONTEXT_SCANNING',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  // Four verified claims and one that failed verification: an unverified-claim rate of
  // 0.2, which is what the context view's badges and the metric should both report.
  const evidence = replaceEvidence(db, spec.id, [
    {
      file: 'packages/orchestrator/src/transition.ts',
      lineStart: 118,
      lineEnd: 196,
      symbol: 'transitionInTx',
      claim: 'All state changes funnel through a single guarded function.',
      relevance:
        'A payout deduction step must be added as a guarded transition, not a side effect.',
      verified: true,
      failureReason: null,
    },
    {
      file: 'packages/orchestrator/src/cost.ts',
      lineStart: 60,
      lineEnd: 72,
      symbol: 'MODEL_PRICING',
      claim: 'Rate tables are data, keyed by identifier, not logic.',
      relevance: 'TDS rates should follow the same shape so they can be versioned.',
      verified: true,
      failureReason: null,
    },
    {
      file: 'packages/db/src/migrations/0001_init.sql',
      lineStart: 1,
      lineEnd: 20,
      symbol: null,
      claim: 'Schema changes are hand-written SQL migrations with checksums.',
      relevance: 'A deduction ledger table will need its own migration.',
      verified: true,
      failureReason: null,
    },
    {
      file: 'packages/contract/src/compliance.ts',
      lineStart: 69,
      lineEnd: 84,
      symbol: 'ComplianceRuleSchema',
      claim: 'Compliance rules already carry superseded-term detection.',
      relevance: 'The 194J to 393 mapping can reuse it rather than adding a new mechanism.',
      verified: true,
      failureReason: null,
    },
    {
      file: 'packages/payouts/src/tds.ts',
      lineStart: 40,
      lineEnd: 95,
      symbol: 'applyTdsDeduction',
      claim: 'An existing helper already applies TDS to a payout.',
      relevance: 'Would be the natural extension point.',
      // The model invented a plausible file. This is exactly the failure the verifier
      // exists to catch, and the fixture keeps it visible in the UI.
      verified: false,
      failureReason: 'file_not_found',
    },
  ]);

  const contextPayload = {
    summary:
      'The orchestrator centralises state changes and the compliance pack already supports superseded-term ' +
      'detection, so TDS deduction should be a guarded transition plus a versioned rate table. No payouts ' +
      'module exists yet.',
    evidence,
    touched_modules: ['packages/orchestrator', 'packages/compliance', 'packages/db'],
    open_questions: ['Is there an existing vendor master, or must one be created?'],
    stats: {
      total_claims: evidence.length,
      verified_claims: evidence.filter((e) => e.verified).length,
      unverified_claims: evidence.filter((e) => !e.verified).length,
      unverified_claim_rate: evidence.filter((e) => !e.verified).length / evidence.length,
      tool_calls_used: 17,
      retrieval_strategy: 'fts_repomap',
    },
  };

  writeArtifact(db, {
    specId: spec.id,
    kind: 'context',
    payload: contextPayload,
    contentMd:
      '# Context\n\n' +
      `${contextPayload.summary}\n\n` +
      '## Evidence\n\n' +
      evidence
        .map(
          (e) =>
            `- \`${e.file}:${String(e.line_start)}-${String(e.line_end)}\` — ` +
            `${e.verified ? 'verified' : `unverified (${e.failure_reason ?? 'unknown'})`} — ${e.claim}`,
        )
        .join('\n') +
      '\n',
    actor: { id: 'context-agent', type: 'agent' },
  });

  transition(db, {
    specId: spec.id,
    from: 'CONTEXT_SCANNING',
    to: 'CONTEXT_READY',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  recordLlmCall(db, {
    specId: spec.id,
    stage: 'context_loop',
    model: 'claude-haiku-5-5',
    usage: {
      inputTokens: 21_800,
      outputTokens: 4_100,
      cacheReadInputTokens: 612_000,
      cacheCreationInputTokens: 46_000,
    },
    latencyMs: 41_900,
    fromCassette: false,
    correlationId: 'run_seed_b',
  });
  recordLlmCall(db, {
    specId: spec.id,
    stage: 'module_summary',
    model: 'claude-haiku-5-5',
    usage: {
      inputTokens: 96_000,
      outputTokens: 11_200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      batch: true,
    },
    latencyMs: 2_400,
    fromCassette: false,
    correlationId: 'run_seed_b',
  });

  return spec.id;
}

/** Spec C: fully approved and released for implementation, with task rows. */
function seedSpecC(): string {
  const title = 'Invoice numbering series';
  const spec = createSpec(db, {
    title: `${FIXTURE_MARKER} ${title}`,
    description: 'Give each financial year its own gap-free invoice numbering series.',
    mode: 'greenfield',
    repo_path: null,
    actor: REVIEWER,
  });

  const v = () => {
    const s = getSpec(db, spec.id);
    if (s === undefined) throw new Error('fixture spec vanished');
    return s;
  };

  const requirements = RequirementsProposalSchema.parse({
    feature_summary: 'Each financial year gets its own gap-free invoice numbering series.',
    requirements: [
      {
        id: 'REQ-001',
        ears_pattern: 'event_driven',
        ears_statement:
          'When an invoice is finalised, the system shall assign the next number in the current financial year series.',
        rationale: 'GST requires a consecutive series with no gaps within a financial year.',
        priority: 'must',
        acceptance_criteria: [
          {
            id: 'AC-001',
            given: 'the last invoice of 2026-27 is numbered 41',
            when: 'another invoice is finalised',
            then: 'it is numbered 42',
            compliance_rule_key: 'GST-002',
          },
          {
            id: 'AC-002',
            given: 'two invoices are finalised at the same moment',
            when: 'both request a number',
            then: 'they receive different consecutive numbers',
            compliance_rule_key: null,
          },
        ],
        source_refs: [],
        compliance_refs: ['GST-002'],
      },
    ],
    clarification_questions: [],
    non_goals: ['Retrospective renumbering of historical invoices'],
  });

  const design = DesignProposalSchema.parse({
    overview:
      'A per-series counter row allocated inside the same transaction as invoice finalisation.',
    sections: [
      {
        id: 'DES-001',
        heading: 'Series counter',
        body: 'One row per (tenant, financial year), incremented under the write lock so the series cannot skip.',
        source_refs: [],
        requirement_ids: ['REQ-001'],
      },
      {
        id: 'DES-002',
        heading: 'Financial year boundary',
        body: 'The series key derives from the invoice date, so 1 April starts a new series automatically.',
        source_refs: [],
        requirement_ids: ['REQ-001'],
      },
    ],
    decisions: [
      {
        id: 'ADR-001',
        decision: 'Allocate the number inside the finalisation transaction.',
        rationale: 'Allocating beforehand leaves a gap whenever finalisation fails.',
        alternatives_considered: ['Pre-allocate from a pool', 'Use a database sequence'],
      },
    ],
    risks: ['A long-running finalisation holds the counter lock and serialises invoicing.'],
  });

  const tasks = TasksProposalSchema.parse({
    implementation_order_rationale:
      'The counter table lands first; the boundary logic is pure and can follow independently.',
    tasks: [
      {
        id: 'TASK-001',
        title: 'Add invoice_series counter table',
        description: 'Migration plus a transactional allocate() helper.',
        status: 'pending',
        requirement_ids: ['REQ-001'],
        design_section_ids: ['DES-001'],
        source_refs: [],
        verifies: ['AC-001', 'AC-002'],
        depends_on: [],
      },
      {
        id: 'TASK-002',
        title: 'Derive the series key from the invoice date',
        description: 'Pure function mapping a date to its Indian financial year label.',
        status: 'pending',
        requirement_ids: ['REQ-001'],
        design_section_ids: ['DES-002'],
        source_refs: [],
        verifies: ['AC-001'],
        depends_on: ['TASK-001'],
      },
    ],
  });

  transition(db, {
    specId: spec.id,
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    actor: SYSTEM,
    expectedVersion: v().version,
  });
  writeArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    payload: requirements,
    contentMd: renderRequirements(title, requirements),
    actor: REQ_AGENT,
  });
  transition(db, {
    specId: spec.id,
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  const reqHead = getHeadArtifact(db, spec.id, 'requirements');
  if (reqHead === undefined) throw new Error('expected requirements');
  decideArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    contentHash: reqHead.contentHash,
    decision: 'approve',
    comment: 'Agreed; the concurrency criterion is the important one.',
    actor: REVIEWER,
    expectedVersion: v().version,
  });

  transition(db, {
    specId: spec.id,
    from: 'REQ_APPROVED',
    to: 'DESIGN_DRAFTING',
    actor: SYSTEM,
    expectedVersion: v().version,
  });
  writeArtifact(db, {
    specId: spec.id,
    kind: 'design',
    payload: design,
    contentMd: renderDesign(title, design),
    actor: DESIGN_AGENT,
  });
  transition(db, {
    specId: spec.id,
    from: 'DESIGN_DRAFTING',
    to: 'DESIGN_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: v().version,
  });

  const designHead = getHeadArtifact(db, spec.id, 'design');
  if (designHead === undefined) throw new Error('expected design');
  decideArtifact(db, {
    specId: spec.id,
    kind: 'design',
    contentHash: designHead.contentHash,
    decision: 'approve',
    comment: 'Transactional allocation is the right call.',
    actor: REVIEWER,
    expectedVersion: v().version,
  });

  writeArtifact(db, {
    specId: spec.id,
    kind: 'tasks',
    payload: tasks,
    contentMd: renderTasks(title, tasks),
    actor: TASK_AGENT,
  });
  transition(db, {
    specId: spec.id,
    from: 'DESIGN_APPROVED',
    to: 'TASKS_GENERATED',
    actor: SYSTEM,
    expectedVersion: v().version,
  });
  syncTasks(db, spec.id, tasks);

  transition(db, {
    specId: spec.id,
    from: 'TASKS_GENERATED',
    to: 'READY_FOR_IMPLEMENTATION',
    actor: REVIEWER,
    expectedVersion: v().version,
    reason: 'Released for implementation.',
  });

  for (const [stage, inputTokens, outputTokens, cacheRead] of [
    ['requirements', 11_200, 3_400, 24_000],
    ['design', 16_900, 5_100, 71_000],
    ['tasks', 9_300, 2_200, 88_000],
  ] as const) {
    recordLlmCall(db, {
      specId: spec.id,
      stage,
      model: 'claude-sonnet-5-5',
      usage: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: 12_000,
      },
      latencyMs: 12_000,
      fromCassette: false,
      correlationId: 'run_seed_c',
    });
  }

  return spec.id;
}

clearFixtures();

const ids = {
  'requirements gate, 2 versions, 1 open clarification': seedSpecA(),
  'brownfield, context ready, 1 unverified claim': seedSpecB(),
  'approved through to implementation, with tasks': seedSpecC(),
};

console.log(`\nseeded ${String(Object.keys(ids).length)} fixture specs into ${resolveDbPath()}:`);
for (const [description, id] of Object.entries(ids)) {
  const spec = getSpec(db, id);
  console.log(`  ${id}  ${spec?.status ?? 'unknown'}  — ${description}`);
}

db.$client.close();
