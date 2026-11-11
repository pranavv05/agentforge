import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * API conformance.
 *
 * Two things are proved here, both Day 1 exit criteria:
 *
 * 1. every implemented route returns data that parses against its contract schema —
 *    this is what lets the frontend track build against the contract alone;
 * 2. a stale content hash is refused with 409 and changes nothing, which is the
 *    governance claim at the HTTP boundary rather than only in the orchestrator.
 *
 * The database path is set before any import so the lazily created singleton points at
 * a temp file, not the developer's working database.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-api-'));
process.env['SDD_DB_PATH'] = join(dir, 'api.db');
process.env['SDD_RUN_COST_CAP_USD'] = '2.00';

// Imported after the env is set, so `getDb()` resolves the temp path.
const { getDb, closeDb } = await import('@agentforge/db');
const {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  listAuditEntries,
  getSpec,
  askClarifications,
  recordLlmCall,
  syncTasks,
  transition,
  writeArtifact,
} = await import('@agentforge/orchestrator');
const { renderRequirements } = await import('@agentforge/agents');
const contract = await import('@agentforge/contract');

const specsRoute = await import('@/app/api/specs/route');
const specRoute = await import('@/app/api/specs/[id]/route');
const artifactRoute = await import('@/app/api/specs/[id]/artifacts/[kind]/route');
const diffRoute = await import('@/app/api/specs/[id]/artifacts/[kind]/diff/route');
const decideRoute = await import('@/app/api/specs/[id]/artifacts/[kind]/decide/route');
const auditRoute = await import('@/app/api/specs/[id]/audit/route');
const costRoute = await import('@/app/api/specs/[id]/cost/route');
const tasksRoute = await import('@/app/api/specs/[id]/tasks/route');
const contextRoute = await import('@/app/api/specs/[id]/context/route');
const clarificationsRoute = await import('@/app/api/specs/[id]/clarifications/route');
const answerRoute = await import('@/app/api/specs/[id]/clarifications/answer/route');
const packRoute = await import('@/app/api/compliance/pack/route');

const ACTOR = { id: 'reviewer@example.com', type: 'human' } as const;
const AGENT = { id: 'requirement-agent', type: 'agent' } as const;
const SYSTEM = { id: 'orchestrator', type: 'orchestrator' } as const;

const requirementsV1 = contract.RequirementsProposalSchema.parse({
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
          then: 'all mandatory fields are present',
          compliance_rule_key: null,
        },
      ],
      source_refs: [],
      compliance_refs: [],
    },
  ],
  clarification_questions: [],
  non_goals: [],
});

const requirementsV2 = contract.RequirementsProposalSchema.parse({
  ...requirementsV1,
  feature_summary: 'Export invoices as GST JSON, including the TDS case.',
});

const tasksProposal = contract.TasksProposalSchema.parse({
  implementation_order_rationale: 'Validator first.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Add validator',
      description: 'Validate mandatory fields.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: [],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: [],
    },
  ],
});

/** A spec parked at the requirements gate with two versions. */
let gateSpecId: string;
/** A spec with clarifications outstanding. */
let clarifySpecId: string;

const url = (path: string): string => `http://localhost:3000${path}`;

/**
 * The reviewer these tests act as.
 *
 * A real account with a real session cookie on every request — see `./session.ts` for
 * why there is no bypass. The email matches ACTOR above, so assertions about audit
 * actors line up whether a row was written through HTTP or straight through the
 * orchestrator.
 */
const { req, anonReq } = await (await import('./session')).createTestSession(ACTOR.id);

/** Reads a handler's JSON body, asserting the status first for clearer failures. */
async function json(response: Response, expectedStatus: number): Promise<unknown> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  return body;
}

function version(specId: string): number {
  const spec = getSpec(getDb(), specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec.version;
}

beforeAll(() => {
  const db = getDb();

  const gate = createSpec(db, {
    title: 'GST invoice export',
    description: 'Export a finalised invoice as GST e-invoice JSON.',
    mode: 'greenfield',
    repo_path: null,
    actor: ACTOR,
  });
  gateSpecId = gate.id;

  transition(db, {
    specId: gate.id,
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    actor: SYSTEM,
    expectedVersion: version(gate.id),
  });
  writeArtifact(db, {
    specId: gate.id,
    kind: 'requirements',
    payload: requirementsV1,
    contentMd: renderRequirements('GST invoice export', requirementsV1),
    actor: AGENT,
  });
  transition(db, {
    specId: gate.id,
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: version(gate.id),
  });

  const v1 = getHeadArtifact(db, gate.id, 'requirements');
  if (v1 === undefined) throw new Error('expected v1');
  decideArtifact(db, {
    specId: gate.id,
    kind: 'requirements',
    contentHash: v1.contentHash,
    decision: 'request_changes',
    comment: 'Add the TDS case.',
    actor: ACTOR,
    expectedVersion: version(gate.id),
  });

  writeArtifact(db, {
    specId: gate.id,
    kind: 'requirements',
    payload: requirementsV2,
    contentMd: renderRequirements('GST invoice export', requirementsV2),
    actor: AGENT,
  });
  transition(db, {
    specId: gate.id,
    from: 'REQ_DRAFTING',
    to: 'REQ_AWAITING_APPROVAL',
    actor: SYSTEM,
    expectedVersion: version(gate.id),
  });

  recordLlmCall(db, {
    specId: gate.id,
    stage: 'requirements',
    model: 'claude-haiku-5-5',
    usage: {
      inputTokens: 9_000,
      outputTokens: 1_500,
      cacheReadInputTokens: 30_000,
      cacheCreationInputTokens: 4_000,
    },
    latencyMs: 2_100,
    fromCassette: false,
    correlationId: 'run_api_test',
  });

  syncTasks(db, gate.id, tasksProposal);

  const clarify = createSpec(db, {
    title: 'Vendor payouts',
    description: 'Pay vendors on a schedule.',
    mode: 'greenfield',
    repo_path: null,
    actor: ACTOR,
  });
  clarifySpecId = clarify.id;
  transition(db, {
    specId: clarify.id,
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    actor: SYSTEM,
    expectedVersion: version(clarify.id),
  });
  askClarifications(db, clarify.id, [
    {
      question: 'Which payout rail?',
      why_it_matters: 'It changes the settlement window.',
      options: ['NEFT', 'IMPS', 'UPI'],
    },
  ]);
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/specs', () => {
  it('returns a schema-valid list', async () => {
    const body = await json(await specsRoute.GET(req('/api/specs')), 200);
    const parsed = contract.ListSpecsResponseSchema.parse(body);
    expect(parsed.total).toBe(2);
    expect(parsed.specs).toHaveLength(2);
  });

  it('applies the status filter', async () => {
    const body = await json(
      await specsRoute.GET(req('/api/specs?status=REQ_AWAITING_APPROVAL')),
      200,
    );
    const parsed = contract.ListSpecsResponseSchema.parse(body);
    expect(parsed.specs.map((s) => s.id)).toEqual([gateSpecId]);
  });

  it('rejects an unknown status with 400', async () => {
    const body = await json(await specsRoute.GET(req('/api/specs?status=NOT_A_STATE')), 400);
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/specs', () => {
  it('creates a greenfield spec', async () => {
    const response = await specsRoute.POST(
      req('/api/specs', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Created over HTTP',
          description: 'A spec created through the API.',
          mode: 'greenfield',
          repo_path: null,
        }),
      }),
    );
    const parsed = contract.CreateSpecResponseSchema.parse(await json(response, 201));
    expect(parsed.spec.status).toBe('CREATED');
    expect(parsed.spec.version).toBe(0);
  });

  it('rejects a greenfield spec that supplies a repo path', async () => {
    const body = await json(
      await specsRoute.POST(
        req('/api/specs', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Contradictory',
            description: 'Greenfield with a repo.',
            mode: 'greenfield',
            repo_path: '/tmp/somewhere',
          }),
        }),
      ),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const body = await json(
      await specsRoute.POST(
        req('/api/specs', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Typo',
            description: 'Has a stray field.',
            mode: 'greenfield',
            repo_path: null,
            repoPath: '/tmp/typo',
          }),
        }),
      ),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a malformed body', async () => {
    const body = await json(
      await specsRoute.POST(req('/api/specs', { method: 'POST', body: 'not json' })),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.message).toContain('not valid JSON');
  });
});

describe('GET /api/specs/:id', () => {
  it('returns the spec with artifacts, approvals and legal transitions', async () => {
    const body = await json(
      await specRoute.GET(req(`/api/specs/${gateSpecId}`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      200,
    );
    const parsed = contract.GetSpecResponseSchema.parse(body);

    expect(parsed.spec.status).toBe('REQ_AWAITING_APPROVAL');
    expect(parsed.artifacts.map((a) => a.kind)).toEqual(['requirements']);
    expect(parsed.approvals).toHaveLength(1);
    // Exactly the moves the orchestrator would accept, FAILED excluded.
    expect([...parsed.available_transitions].sort()).toEqual(['REQ_APPROVED', 'REQ_DRAFTING']);
  });

  it('returns 404 for an unknown spec', async () => {
    const body = await json(
      await specRoute.GET(req('/api/specs/nope'), {
        params: Promise.resolve({ id: 'nope' }),
      }),
      404,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/specs/:id/artifacts/:kind', () => {
  it('returns the head version and full history', async () => {
    const body = await json(
      await artifactRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      200,
    );
    const parsed = contract.GetArtifactResponseSchema.parse(body);

    expect(parsed.artifact.version).toBe(2);
    expect(parsed.history.map((h) => h.version)).toEqual([1, 2]);
    // Each history entry exposes its hash, so the UI can show what an approval bound to.
    expect(parsed.history[0]?.content_hash).not.toBe(parsed.history[1]?.content_hash);
    expect(parsed.artifact.content_md).toContain('# Requirements:');
  });

  it('returns a specific version on request', async () => {
    const body = await json(
      await artifactRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements?version=1`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      200,
    );
    expect(contract.GetArtifactResponseSchema.parse(body).artifact.version).toBe(1);
  });

  it('404s for a version that does not exist', async () => {
    const body = await json(
      await artifactRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements?version=99`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      404,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('NOT_FOUND');
  });

  it('400s for an invalid artifact kind', async () => {
    const body = await json(
      await artifactRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/bogus`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'bogus' }),
      }),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });

  it('404s for a kind with no versions yet', async () => {
    const body = await json(
      await artifactRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/design`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'design' }),
      }),
      404,
    );
    expect(contract.ApiErrorSchema.parse(body).error.message).toContain('no design artifact');
  });
});

describe('GET /api/specs/:id/artifacts/:kind/diff', () => {
  it('diffs two versions of the rendered markdown', async () => {
    const body = await json(
      await diffRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements/diff?from=1&to=2`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      200,
    );
    const parsed = contract.DiffArtifactResponseSchema.parse(body);

    expect(parsed.from_version).toBe(1);
    expect(parsed.to_version).toBe(2);
    expect(parsed.hunks.length).toBeGreaterThan(0);

    const added = parsed.hunks.flatMap((h) => h.lines.filter((l) => l.op === 'add'));
    expect(added.some((l) => l.text.includes('including the TDS case'))).toBe(true);
  });

  it('returns no hunks when diffing a version against itself', async () => {
    const body = await json(
      await diffRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements/diff?from=2&to=2`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      200,
    );
    expect(contract.DiffArtifactResponseSchema.parse(body).hunks).toEqual([]);
  });

  it('400s when from or to is missing', async () => {
    const body = await json(
      await diffRoute.GET(req(`/api/specs/${gateSpecId}/artifacts/requirements/diff?from=1`), {
        params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }),
      }),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/specs/:id/artifacts/:kind/decide', () => {
  const decide = async (body: Record<string, unknown>): Promise<Response> =>
    await decideRoute.POST(
      req(`/api/specs/${gateSpecId}/artifacts/requirements/decide`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }) },
    );

  it('refuses a stale content hash with 409 and changes nothing', async () => {
    const before = getSpec(getDb(), gateSpecId);

    const body = await json(
      await decide({
        expected_version: version(gateSpecId),
        content_hash: 'f'.repeat(64),
        decision: 'approve',
        comment: null,
      }),
      409,
    );

    const error = contract.ApiErrorSchema.parse(body).error;
    expect(error.code).toBe('HASH_MISMATCH');
    expect(error.correlation_id).toMatch(/^run_/);

    const after = getSpec(getDb(), gateSpecId);
    expect(after?.status).toBe(before?.status);
    expect(after?.version).toBe(before?.version);
  });

  it('refuses a stale expected_version with 409', async () => {
    const head = getHeadArtifact(getDb(), gateSpecId, 'requirements');
    if (head === undefined) throw new Error('expected head');

    const body = await json(
      await decide({
        expected_version: 0,
        content_hash: head.contentHash,
        decision: 'approve',
        comment: null,
      }),
      409,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VERSION_CONFLICT');
  });

  it('rejects a malformed hash before touching the database', async () => {
    const body = await json(
      await decide({
        expected_version: version(gateSpecId),
        content_hash: 'too-short',
        decision: 'approve',
        comment: null,
      }),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });

  it('approves the current version and advances the spec', async () => {
    const head = getHeadArtifact(getDb(), gateSpecId, 'requirements');
    if (head === undefined) throw new Error('expected head');

    const parsed = contract.DecideArtifactResponseSchema.parse(
      await json(
        await decide({
          expected_version: version(gateSpecId),
          content_hash: head.contentHash,
          decision: 'approve',
          comment: 'Approved.',
        }),
        200,
      ),
    );

    expect(parsed.spec.status).toBe('REQ_APPROVED');
    expect(parsed.approval.decision).toBe('approve');
    expect(parsed.approval.content_hash).toBe(head.contentHash);
  });
});

describe('GET /api/specs/:id/audit', () => {
  it('returns the ordered, append-only timeline', async () => {
    const body = await json(
      await auditRoute.GET(req(`/api/specs/${gateSpecId}/audit`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      200,
    );
    const parsed = contract.GetAuditResponseSchema.parse(body);

    expect(parsed.entries[0]?.to_state).toBe('CREATED');
    expect(parsed.entries.at(-1)?.to_state).toBe('REQ_APPROVED');
    // Only humans appear on approval entries.
    const approvalEntry = parsed.entries.find((e) => e.to_state === 'REQ_APPROVED');
    expect(approvalEntry?.actor_type).toBe('human');
  });
});

describe('GET /api/specs/:id/cost', () => {
  it('returns measured spend with a cache hit rate', async () => {
    const body = await json(
      await costRoute.GET(req(`/api/specs/${gateSpecId}/cost`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      200,
    );
    const parsed = contract.GetCostResponseSchema.parse(body);

    expect(parsed.cost.call_count).toBe(1);
    expect(parsed.cost.cap_usd).toBe(2);
    expect(parsed.cost.cache_hit_rate).toBeGreaterThan(0);
    expect(parsed.cost.total_cost_usd).toBeGreaterThan(0);
  });
});

describe('GET /api/specs/:id/tasks', () => {
  it('returns task rows with their traceability fields', async () => {
    const body = await json(
      await tasksRoute.GET(req(`/api/specs/${gateSpecId}/tasks`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      200,
    );
    const parsed = contract.ListTasksResponseSchema.parse(body);

    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.task_key).toBe('TASK-001');
    expect(parsed.tasks[0]?.status).toBe('pending');
    expect(parsed.tasks[0]?.verifies).toEqual(['AC-001']);
  });
});

describe('GET /api/specs/:id/context', () => {
  it('returns null for a greenfield spec rather than an error', async () => {
    const body = await json(
      await contextRoute.GET(req(`/api/specs/${gateSpecId}/context`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      200,
    );
    expect(contract.GetContextResponseSchema.parse(body).bundle).toBeNull();
  });
});

describe('clarifications', () => {
  it('lists open questions', async () => {
    const body = await json(
      await clarificationsRoute.GET(req(`/api/specs/${clarifySpecId}/clarifications`), {
        params: Promise.resolve({ id: clarifySpecId }),
      }),
      200,
    );
    const parsed = contract.ListClarificationsResponseSchema.parse(body);

    expect(parsed.clarifications).toHaveLength(1);
    expect(parsed.clarifications[0]?.answer).toBeNull();
    expect(parsed.clarifications[0]?.options).toEqual(['NEFT', 'IMPS', 'UPI']);
  });

  it('records an answer', async () => {
    const listed = contract.ListClarificationsResponseSchema.parse(
      await json(
        await clarificationsRoute.GET(req(`/api/specs/${clarifySpecId}/clarifications`), {
          params: Promise.resolve({ id: clarifySpecId }),
        }),
        200,
      ),
    );
    const target = listed.clarifications[0];
    if (target === undefined) throw new Error('expected a clarification');

    const body = await json(
      await answerRoute.POST(
        req(`/api/specs/${clarifySpecId}/clarifications/answer`, {
          method: 'POST',
          body: JSON.stringify({
            expected_version: version(clarifySpecId),
            answers: [{ clarification_id: target.id, answer: 'NEFT only.' }],
          }),
        }),
        { params: Promise.resolve({ id: clarifySpecId }) },
      ),
      200,
    );

    const parsed = contract.ListClarificationsResponseSchema.parse(body);
    expect(parsed.clarifications[0]?.answer).toBe('NEFT only.');
    // The signed-in account, resolved from the session cookie — not a configured
    // default. Before authentication was real this read back a fixed dev identity, so
    // the assertion proved nothing about who had actually answered.
    expect(parsed.clarifications[0]?.answered_by).toBe(ACTOR.id);
  });

  it('404s when answering a clarification from another spec', async () => {
    const body = await json(
      await answerRoute.POST(
        req(`/api/specs/${gateSpecId}/clarifications/answer`, {
          method: 'POST',
          body: JSON.stringify({
            expected_version: version(gateSpecId),
            answers: [{ clarification_id: 'clr_not_mine', answer: 'x' }],
          }),
        }),
        { params: Promise.resolve({ id: gateSpecId }) },
      ),
      404,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/compliance/pack', () => {
  it('404s with a clear message until a pack is loaded', async () => {
    // Deliberate: an empty rule set would read as "nothing to comply with", which is
    // the opposite of the truth. The pack lands with the compliance package.
    const body = await json(await packRoute.GET(req('/api/compliance/pack')), 404);
    expect(contract.ApiErrorSchema.parse(body).error.message).toContain(
      'no compliance pack has been loaded',
    );
  });
});

describe('the authentication gate', () => {
  /**
   * The gate, driven from outside.
   *
   * This is what makes the audit log evidence rather than decoration. The log records
   * the actor verbatim, so it proves exactly as much as the thing that resolved the
   * actor — and before authentication was real, that was a request header anyone could
   * set. These tests hold the boundary to its claim: no session, no actor, no write.
   *
   * `handle` authenticates before it parses anything, so a request is refused on its
   * session rather than on its payload. An unauthenticated caller learns nothing about
   * whether their body was well-formed, or whether a spec id exists.
   */

  it('refuses an unauthenticated read with 401', async () => {
    const body = await json(await specsRoute.GET(anonReq('/api/specs')), 401);
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unauthenticated read of a specific spec', async () => {
    // Private project data, not just mutations: a spec list, an artifact and an audit
    // trail are all things an anonymous caller should not see.
    const body = await json(
      await specRoute.GET(anonReq(`/api/specs/${gateSpecId}`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      401,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unauthenticated audit read', async () => {
    const body = await json(
      await auditRoute.GET(anonReq(`/api/specs/${gateSpecId}/audit`), {
        params: Promise.resolve({ id: gateSpecId }),
      }),
      401,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unauthenticated approval and changes nothing', async () => {
    const head = getHeadArtifact(getDb(), gateSpecId, 'requirements');
    if (head === undefined) throw new Error('no requirements artifact');

    const statusBefore = getSpec(getDb(), gateSpecId)?.status;
    const auditBefore = listAuditEntries(getDb(), gateSpecId).length;

    const body = await json(
      await decideRoute.POST(
        anonReq(`/api/specs/${gateSpecId}/artifacts/requirements/decide`, {
          method: 'POST',
          body: JSON.stringify({
            content_hash: head.contentHash,
            decision: 'approve',
            comment: 'should never be recorded',
            expected_version: version(gateSpecId),
          }),
        }),
        { params: Promise.resolve({ id: gateSpecId, kind: 'requirements' }) },
      ),
      401,
    );

    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
    // The point of the test: an anonymous approval leaves no trace and moves nothing.
    expect(getSpec(getDb(), gateSpecId)?.status).toBe(statusBefore);
    expect(listAuditEntries(getDb(), gateSpecId)).toHaveLength(auditBefore);
  });

  it('refuses a forged session cookie', async () => {
    // Sessions are signed, so inventing a plausible-looking token is not enough. If this
    // ever passed, every approval in the audit log would be forgeable.
    const forged = new Request(url('/api/specs'), {
      headers: { cookie: 'better-auth.session_token=not-a-real-token' },
    });

    const body = await json(await specsRoute.GET(forged), 401);
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unauthenticated request before it parses the body', async () => {
    // Deliberately malformed JSON *and* no session. A 401 rather than a 400 proves the
    // ordering: the gate runs first, so a prober cannot use error codes to learn whether
    // their payload shape was right.
    const body = await json(
      await specsRoute.POST(anonReq('/api/specs', { method: 'POST', body: 'not json' })),
      401,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('UNAUTHENTICATED');
  });

  it('records the signed-in account as the actor, not a configured default', async () => {
    // The positive case. Taken together with the refusals above, this is what lets the
    // audit log name a person: the identity is the session's, and there is no path that
    // produces an actor without one.
    const created = contract.CreateSpecResponseSchema.parse(
      await json(
        await specsRoute.POST(
          req('/api/specs', {
            method: 'POST',
            body: JSON.stringify({
              title: 'Actor attribution check',
              description: 'Confirms the audit log names the signed-in account.',
              mode: 'greenfield',
              repo_path: null,
            }),
          }),
        ),
        201,
      ),
    );

    const entries = listAuditEntries(getDb(), created.spec.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actor).toBe(ACTOR.id);
    expect(entries[0]?.actorType).toBe('human');
  });
});
