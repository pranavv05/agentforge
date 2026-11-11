import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The agent-invoking routes.
 *
 * These are the first routes that run a model call, so what matters is that the HTTP
 * layer adds its own guarantees on top of the agent: the caller's view of the spec must
 * be current, a retry is safe, and an agent failure becomes a typed status rather than
 * a 500.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-draft-'));
process.env['SDD_DB_PATH'] = join(dir, 'draft.db');
process.env['SDD_RUN_COST_CAP_USD'] = '2.00';
process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-haiku-5-5';
process.env['SDD_MODEL_DESIGN'] = 'claude-haiku-5-5';

const { getDb, closeDb } = await import('@agentforge/db');
const {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  listArtifactVersions,
  listAuditEntries,
  transition,
} = await import('@agentforge/orchestrator');
const contract = await import('@agentforge/contract');
const { installStub } = await import('../../../packages/llm/test/stub.ts');

const requirementsDraft = await import('@/app/api/specs/[id]/requirements/draft/route');
const designDraft = await import('@/app/api/specs/[id]/design/draft/route');
const tasksGenerate = await import('@/app/api/specs/[id]/tasks/generate/route');

type Stub = ReturnType<typeof installStub>;

const HUMAN = { id: 'reviewer@example.com', type: 'human' } as const;
const ORCHESTRATOR = { id: 'orchestrator', type: 'orchestrator' } as const;

const REQUIREMENTS_OUTPUT = {
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
};

const QUESTIONS_OUTPUT = {
  feature_summary: 'Unclear scope.',
  requirements: [],
  clarification_questions: [
    {
      question: 'Credit notes too?',
      why_it_matters: 'It doubles the field set.',
      options: ['No', 'Yes'],
    },
  ],
  non_goals: [],
};

const DESIGN_OUTPUT = {
  overview: 'A serialiser and a validator.',
  sections: [
    {
      id: 'DES-001',
      heading: 'Serialiser',
      body: 'Map the invoice onto the GST schema.',
      source_refs: [],
      requirement_ids: ['REQ-001'],
    },
  ],
  decisions: [],
  risks: [],
};

const TASKS_OUTPUT = {
  implementation_order_rationale: 'Serialiser first; validation depends on it.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Map the invoice onto the GST schema',
      description: 'Build the serialiser that produces the payload.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-001'],
      depends_on: [],
    },
  ],
};

let stub: Stub;

/**
 * A real signed-in reviewer — see ./session.ts for why there is no bypass.
 *
 * Drafting is a mutating route, so it is refused outright without a session; these
 * tests would all 401 otherwise.
 */
const { req } = await (await import('./session')).createTestSession(HUMAN.id);

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

/** A fresh greenfield spec in REQ_DRAFTING. */
function newDraftingSpec(title = 'GST invoice export'): string {
  const spec = createSpec(getDb(), {
    title,
    description: 'Export a finalised invoice as GST e-invoice JSON.',
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
  return spec.id;
}

const draftRequirements = async (specId: string, body: Record<string, unknown>) =>
  await requirementsDraft.POST(
    req(`/api/specs/${specId}/requirements/draft`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: specId }) },
  );

const generateTasks = async (specId: string, body: Record<string, unknown>) =>
  await tasksGenerate.POST(
    req(`/api/specs/${specId}/tasks/generate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: specId }) },
  );

const draftDesign = async (specId: string, body: Record<string, unknown>) =>
  await designDraft.POST(
    req(`/api/specs/${specId}/design/draft`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: specId }) },
  );

beforeEach(() => {
  stub = installStub();
});

afterEach(() => {
  stub.restore();
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/specs/:id/requirements/draft', () => {
  it('returns the proposed artifact and the advanced spec', async () => {
    const specId = newDraftingSpec();
    stub.reply({ output: REQUIREMENTS_OUTPUT });

    const body = await json(
      await draftRequirements(specId, {
        expected_version: version(specId),
        idempotency_key: 'draft-attempt-1',
      }),
      200,
    );
    const parsed = contract.DraftArtifactResponseSchema.parse(body);

    expect(parsed.spec.status).toBe('REQ_AWAITING_APPROVAL');
    expect(parsed.artifact?.kind).toBe('requirements');
    expect(parsed.artifact?.version).toBe(1);
    expect(parsed.artifact?.content_md).toContain('REQ-001');
    expect(parsed.clarifications).toEqual([]);
  });

  it('returns the questions when the agent asks instead of proposing', async () => {
    const specId = newDraftingSpec('Vendor payouts');
    stub.reply({ output: QUESTIONS_OUTPUT });

    const parsed = contract.DraftArtifactResponseSchema.parse(
      await json(
        await draftRequirements(specId, {
          expected_version: version(specId),
          idempotency_key: 'ask-round-1',
        }),
        200,
      ),
    );

    expect(parsed.spec.status).toBe('REQ_AWAITING_CLARIFICATION');
    expect(parsed.artifact).toBeNull();
    expect(parsed.clarifications).toHaveLength(1);
    expect(parsed.clarifications[0]?.question).toBe('Credit notes too?');
  });

  it('refuses a stale expected_version with 409 and makes no model call', async () => {
    const specId = newDraftingSpec('Stale tab');
    stub.reply({ output: REQUIREMENTS_OUTPUT });

    const body = await json(
      await draftRequirements(specId, {
        expected_version: 99,
        idempotency_key: 'stale-attempt-1',
      }),
      409,
    );

    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VERSION_CONFLICT');
    // Nothing was spent acting on a stale page.
    expect(stub.calls).toHaveLength(0);
  });

  it('replays a retried call rather than drafting twice', async () => {
    const specId = newDraftingSpec('Retry safe');
    stub.reply({ output: REQUIREMENTS_OUTPUT });

    const first = contract.DraftArtifactResponseSchema.parse(
      await json(
        await draftRequirements(specId, {
          expected_version: version(specId),
          idempotency_key: 'same-key',
        }),
        200,
      ),
    );

    // The retry arrives after the spec has already advanced, which is exactly what a
    // client timeout looks like. It must succeed, not 409.
    const retry = contract.DraftArtifactResponseSchema.parse(
      await json(
        await draftRequirements(specId, {
          expected_version: version(specId),
          idempotency_key: 'same-key',
        }),
        200,
      ),
    );

    expect(retry.artifact?.id).toBe(first.artifact?.id);
    expect(listArtifactVersions(getDb(), specId, 'requirements')).toHaveLength(1);
    // The replay issued no second model call.
    expect(stub.calls).toHaveLength(1);
  });

  it('rejects a body missing the idempotency key', async () => {
    const specId = newDraftingSpec('No key');
    const body = await json(
      await draftRequirements(specId, { expected_version: version(specId) }),
      400,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('VALIDATION_FAILED');
  });

  it('maps an agent refusal to 502 rather than a 500', async () => {
    const specId = newDraftingSpec('Refused');
    stub.reply({
      output: null,
      stopReason: 'refusal',
      stopDetails: { category: 'cyber', explanation: 'declined' },
    });

    const body = await json(
      await draftRequirements(specId, {
        expected_version: version(specId),
        idempotency_key: 'refused-1',
      }),
      502,
    );

    const error = contract.ApiErrorSchema.parse(body).error;
    expect(error.code).toBe('UPSTREAM_FAILED');
    expect(error.correlation_id).toMatch(/^run_/);
  });

  it('starts the stage from CREATED, moving the spec as the orchestrator', async () => {
    // This used to be a 409, which encoded a real limitation rather than a rule:
    // `CREATED -> REQ_DRAFTING` has always been a legal edge, but no route ever took it,
    // so a spec could be created over HTTP and then never started. An interface could
    // not drive the pipeline at all.
    const spec = createSpec(getDb(), {
      title: 'Still created',
      description: 'Has not started drafting.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    stub.reply({ output: REQUIREMENTS_OUTPUT });

    const parsed = contract.DraftArtifactResponseSchema.parse(
      await json(
        await draftRequirements(spec.id, {
          expected_version: spec.version,
          idempotency_key: 'from-created',
        }),
        200,
      ),
    );

    expect(parsed.spec.status).toBe('REQ_AWAITING_APPROVAL');

    // The orchestrator made the move, not the agent. Keeping those two actors apart is
    // what lets the audit log prove no agent advanced its own work.
    const entry = listAuditEntries(getDb(), spec.id).find(
      (row) => row.fromState === 'CREATED' && row.toState === 'REQ_DRAFTING',
    );
    expect(entry?.actorType).toBe('orchestrator');
  });

  it('still refuses to draft away from a pending approval gate', async () => {
    // The transition table permits `REQ_AWAITING_APPROVAL -> REQ_DRAFTING`, and the
    // route deliberately does not take it. Abandoning a gate a human has not answered is
    // a decision they should make explicitly through `request_changes`, not something
    // that happens because someone pressed draft again.
    const specId = await specAwaitingApproval('Pending gate');

    const body = await json(
      await draftRequirements(specId, {
        expected_version: version(specId),
        idempotency_key: 'pending-gate',
      }),
      409,
    );

    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('PRECONDITION_FAILED');
    // Nothing moved, and no model call was made.
    expect(getSpec(getDb(), specId)?.status).toBe('REQ_AWAITING_APPROVAL');
  });
});

/** Drives a spec to REQ_AWAITING_APPROVAL through the real drafting route. */
async function specAwaitingApproval(title: string): Promise<string> {
  const spec = createSpec(getDb(), {
    title,
    description: 'Needs a decision before anything else happens.',
    mode: 'greenfield',
    repo_path: null,
    actor: HUMAN,
  });

  stub.reply({ output: REQUIREMENTS_OUTPUT });
  await draftRequirements(spec.id, {
    expected_version: spec.version,
    idempotency_key: `awaiting-${spec.id}`,
  });

  return spec.id;
}

describe('POST /api/specs/:id/design/draft', () => {
  /** Drives a spec to DESIGN_DRAFTING through the real approval gate. */
  async function specInDesignDrafting(title: string): Promise<string> {
    const specId = newDraftingSpec(title);
    stub.reply({ output: REQUIREMENTS_OUTPUT });
    await draftRequirements(specId, {
      expected_version: version(specId),
      idempotency_key: `${title}-req`,
    });

    const head = getHeadArtifact(getDb(), specId, 'requirements');
    if (head === undefined) throw new Error('expected requirements');
    decideArtifact(getDb(), {
      specId,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: version(specId),
    });
    transition(getDb(), {
      specId,
      from: 'REQ_APPROVED',
      to: 'DESIGN_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: version(specId),
    });
    return specId;
  }

  it('produces the design and reaches the design approval gate', async () => {
    const specId = await specInDesignDrafting('Design happy path');
    stub.reply({ output: DESIGN_OUTPUT });

    const parsed = contract.DraftArtifactResponseSchema.parse(
      await json(
        await draftDesign(specId, {
          expected_version: version(specId),
          idempotency_key: 'design-1',
        }),
        200,
      ),
    );

    expect(parsed.spec.status).toBe('DESIGN_AWAITING_APPROVAL');
    expect(parsed.artifact?.kind).toBe('design');
    expect(parsed.artifact?.content_md).toContain('DES-001');
  });

  it('maps an uncovered must-have requirement to 422', async () => {
    const specId = await specInDesignDrafting('Uncovered');
    stub.reply({
      output: {
        ...DESIGN_OUTPUT,
        sections: [{ ...DESIGN_OUTPUT.sections[0], requirement_ids: [] }],
      },
    });

    const body = await json(
      await draftDesign(specId, {
        expected_version: version(specId),
        idempotency_key: 'uncovered-1',
      }),
      422,
    );

    const error = contract.ApiErrorSchema.parse(body).error;
    expect(error.code).toBe('GROUNDING_FAILED');
    expect(error.message).toContain('REQ-001');
  });

  it('refuses to draft a design before requirements are approved', async () => {
    const specId = newDraftingSpec('Too early');
    const body = await json(
      await draftDesign(specId, {
        expected_version: version(specId),
        idempotency_key: 'early-attempt-1',
      }),
      409,
    );
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('PRECONDITION_FAILED');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('GET /api/specs/:id/stream', () => {
  it('emits the current state and cost, then a terminal done', async () => {
    const specId = newDraftingSpec('Streaming');
    stub.reply({ output: REQUIREMENTS_OUTPUT });
    await draftRequirements(specId, {
      expected_version: version(specId),
      idempotency_key: 'stream-req',
    });

    const streamRoute = await import('@/app/api/specs/[id]/stream/route');
    const controller = new AbortController();
    const response = streamRoute.GET(
      req(`/api/specs/${specId}/stream`, { signal: controller.signal }),
      { params: Promise.resolve({ id: specId }) },
    );

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const body = response.body;
    if (body === null) throw new Error('expected a stream body');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    // The spec is parked at a human gate, so the stream emits state, cost and done and
    // then closes on its own.
    for (let i = 0; i < 5; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const chunk of decoder.decode(value).split('\n\n')) {
        const line = chunk.trim();
        if (!line.startsWith('data: ')) continue;
        events.push(JSON.parse(line.slice('data: '.length)));
      }
      if (events.some((e) => (e as { type: string }).type === 'done')) break;
    }

    controller.abort();
    await reader.cancel().catch(() => undefined);

    const parsed = events.map((e) => contract.StreamEventSchema.parse(e));
    expect(parsed[0]).toEqual({ type: 'state', state: 'REQ_AWAITING_APPROVAL' });
    expect(parsed.some((e) => e.type === 'cost')).toBe(true);
    expect(parsed.at(-1)?.type).toBe('done');
  });
});

/** Drives a spec to DESIGN_AWAITING_APPROVAL — one gate short of tasks. */
async function specInDesignAwaitingApproval(title: string): Promise<string> {
  const specId = newDraftingSpec(title);

  stub.reply({ output: REQUIREMENTS_OUTPUT });
  await draftRequirements(specId, {
    expected_version: version(specId),
    idempotency_key: `${title}-req`,
  });

  const requirements = getHeadArtifact(getDb(), specId, 'requirements');
  if (requirements === undefined) throw new Error('expected requirements');
  decideArtifact(getDb(), {
    specId,
    kind: 'requirements',
    contentHash: requirements.contentHash,
    decision: 'approve',
    actor: HUMAN,
    expectedVersion: version(specId),
  });

  stub.reply({ output: DESIGN_OUTPUT });
  await draftDesign(specId, {
    expected_version: version(specId),
    idempotency_key: `${title}-design`,
  });

  return specId;
}

describe('POST /api/specs/:id/tasks/generate', () => {
  /** Drives a spec all the way to DESIGN_APPROVED through the real gates. */
  async function specWithApprovedDesign(title: string): Promise<string> {
    const specId = newDraftingSpec(title);

    stub.reply({ output: REQUIREMENTS_OUTPUT });
    await draftRequirements(specId, {
      expected_version: version(specId),
      idempotency_key: `${title}-req`,
    });

    const requirements = getHeadArtifact(getDb(), specId, 'requirements');
    if (requirements === undefined) throw new Error('expected requirements');
    decideArtifact(getDb(), {
      specId,
      kind: 'requirements',
      contentHash: requirements.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: version(specId),
    });

    stub.reply({ output: DESIGN_OUTPUT });
    await draftDesign(specId, {
      expected_version: version(specId),
      idempotency_key: `${title}-design`,
    });

    const design = getHeadArtifact(getDb(), specId, 'design');
    if (design === undefined) throw new Error('expected design');
    decideArtifact(getDb(), {
      specId,
      kind: 'design',
      contentHash: design.contentHash,
      decision: 'approve',
      actor: HUMAN,
      expectedVersion: version(specId),
    });

    return specId;
  }

  it('generates tasks from an approved design and reaches TASKS_GENERATED', async () => {
    // This route had no coverage at all, which is how it shipped broken: it advanced the
    // spec to TASKS_GENERATED *before* running the agent, and the `tasks_artifact_exists`
    // guard on that edge refused with a 409 reading "no tasks artifact exists for this
    // spec yet". TASKS_GENERATED is a result state — the Task Agent runs from
    // DESIGN_APPROVED and performs the transition itself once it has written.
    const specId = await specWithApprovedDesign('Tasks happy path');
    expect(getSpec(getDb(), specId)?.status).toBe('DESIGN_APPROVED');

    stub.reply({ output: TASKS_OUTPUT });

    const parsed = contract.DraftArtifactResponseSchema.parse(
      await json(
        await generateTasks(specId, {
          expected_version: version(specId),
          idempotency_key: 'tasks-happy-1',
        }),
        200,
      ),
    );

    expect(parsed.spec.status).toBe('TASKS_GENERATED');
    expect(parsed.artifact?.kind).toBe('tasks');
    expect(parsed.artifact?.content_md).toContain('TASK-001');
  });

  it('refuses before the design is approved', async () => {
    const specId = await specInDesignAwaitingApproval('Tasks too early');

    const body = await json(
      await generateTasks(specId, {
        expected_version: version(specId),
        idempotency_key: 'tasks-too-early',
      }),
      409,
    );

    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('PRECONDITION_FAILED');
    expect(getSpec(getDb(), specId)?.status).toBe('DESIGN_AWAITING_APPROVAL');
  });
});
