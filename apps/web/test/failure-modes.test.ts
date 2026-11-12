import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * What happens when things go wrong.
 *
 * Every bug that reached a user in this project was on a path no test walked. The happy
 * path now has one end to end; this covers the ways a real person gets off it — a stale
 * tab, a typo'd repository path, a rejection, a spend ceiling — and asserts two things
 * each time:
 *
 * 1. the failure is *classified*, so the interface can say something useful rather than
 *    showing a 500 and a correlation id;
 * 2. **nothing moved.** A refused action that half-committed would be worse than one
 *    that failed loudly, and on a tool whose claim is that gates hold, it would be the
 *    claim itself failing.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-failures-'));
process.env['SDD_DB_PATH'] = join(dir, 'failures.db');
process.env['SDD_RUN_COST_CAP_USD'] = '5.00';

const { getDb, closeDb } = await import('@agentforge/db');
const { createSpec, decideArtifact, getHeadArtifact, getSpec, listAuditEntries } =
  await import('@agentforge/orchestrator');
const contract = await import('@agentforge/contract');
const { installStub } = await import('../../../packages/llm/test/stub.ts');

const requirementsDraft = await import('@/app/api/specs/[id]/requirements/draft/route');
const contextScan = await import('@/app/api/specs/[id]/context/scan/route');
const decide = await import('@/app/api/specs/[id]/artifacts/[kind]/decide/route');

const HUMAN = { id: 'reviewer@example.com', type: 'human' } as const;
const { req } = await (await import('./session')).createTestSession(HUMAN.id);

const REQUIREMENTS = {
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

let stub: ReturnType<typeof installStub>;

function spec(id: string) {
  const row = getSpec(getDb(), id);
  if (row === undefined) throw new Error('spec vanished');
  return row;
}

function newSpec(title: string, mode: 'greenfield' | 'brownfield' = 'greenfield', repo?: string) {
  return createSpec(getDb(), {
    title,
    description: 'A spec used to drive a failure mode.',
    mode,
    repo_path: repo ?? null,
    actor: HUMAN,
  }).id;
}

async function body(response: Response, expected: number): Promise<unknown> {
  const payload: unknown = await response.json();
  expect(response.status, JSON.stringify(payload).slice(0, 300)).toBe(expected);
  return payload;
}

function errorCode(payload: unknown): string {
  return contract.ApiErrorSchema.parse(payload).error.code;
}

beforeAll(() => {
  stub = installStub();
});

afterAll(() => {
  stub.restore();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('a stale tab', () => {
  it('refuses a draft against an out-of-date version and changes nothing', async () => {
    const id = newSpec('Stale draft');
    const before = spec(id).status;
    const auditBefore = listAuditEntries(getDb(), id).length;

    const payload = await body(
      await requirementsDraft.POST(
        req(`/api/specs/${id}/requirements/draft`, {
          method: 'POST',
          body: JSON.stringify({
            // The page was loaded when the spec was at a different version.
            expected_version: spec(id).version + 5,
            idempotency_key: 'stale-version-1',
          }),
        }),
        { params: Promise.resolve({ id }) },
      ),
      409,
    );

    expect(errorCode(payload)).toBe('VERSION_CONFLICT');
    expect(spec(id).status).toBe(before);
    expect(listAuditEntries(getDb(), id)).toHaveLength(auditBefore);
    // Refused before the model was reached, so nothing was billed either.
    expect(stub.calls).toHaveLength(0);
  });

  it('refuses an approval of bytes that are no longer current', async () => {
    const id = newSpec('Stale hash');
    stub.reply({ output: REQUIREMENTS });

    await requirementsDraft.POST(
      req(`/api/specs/${id}/requirements/draft`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: spec(id).version,
          idempotency_key: 'stale-hash-draft',
        }),
      }),
      { params: Promise.resolve({ id }) },
    );

    const before = spec(id).status;

    const payload = await body(
      await decide.POST(
        req(`/api/specs/${id}/artifacts/requirements/decide`, {
          method: 'POST',
          body: JSON.stringify({
            // A hash the reviewer read on a page that has since been superseded.
            content_hash: 'b'.repeat(64),
            decision: 'approve',
            comment: null,
            expected_version: spec(id).version,
          }),
        }),
        { params: Promise.resolve({ id, kind: 'requirements' }) },
      ),
      409,
    );

    expect(errorCode(payload)).toBe('HASH_MISMATCH');
    expect(spec(id).status).toBe(before);
  });
});

describe('a repository path that is wrong', () => {
  it('is refused at creation, before a spec exists at all', () => {
    // The single most likely thing a new user gets wrong. It is caught earlier than
    // expected — `createSpec` resolves and stats the path — which is the better place:
    // no spec row is written, so there is nothing half-made to clean up, and the person
    // finds out while the path is still in front of them rather than one screen later.
    expect(() => newSpec('Bad repo', 'brownfield', join(dir, 'definitely-not-here'))).toThrow(
      /repo_path does not exist/,
    );

    // Classified, so the composer can show it rather than a correlation id.
    try {
      newSpec('Bad repo again', 'brownfield', join(dir, 'definitely-not-here'));
      throw new Error('expected a validation failure');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('VALIDATION_FAILED');
      // The message names the path, which is the only actionable part.
      expect((error as Error).message).toContain('definitely-not-here');
    }
  });

  it('rejects a retrieval strategy the contract no longer names', async () => {
    // fts_repomap_embed used to be accepted by the schema and refused later by the agent.
    // It is gone from the contract, so it is refused at the boundary like any unknown
    // value — before a spec row is touched.
    const id = newSpec('Removed arm', 'brownfield', dir);

    const payload = await body(
      await contextScan.POST(
        req(`/api/specs/${id}/context/scan`, {
          method: 'POST',
          body: JSON.stringify({
            expected_version: spec(id).version,
            strategy: 'fts_repomap_embed',
            max_tool_calls: null,
          }),
        }),
        { params: Promise.resolve({ id }) },
      ),
      400,
    );

    expect(errorCode(payload)).toBe('VALIDATION_FAILED');
  });
});

describe('sending work back', () => {
  it('returns requirements to drafting and lets the agent run again', async () => {
    const id = newSpec('Rejected once');
    stub.reply({ output: REQUIREMENTS });

    await requirementsDraft.POST(
      req(`/api/specs/${id}/requirements/draft`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: spec(id).version,
          idempotency_key: 'reject-draft-1',
        }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(spec(id).status).toBe('REQ_AWAITING_APPROVAL');

    const head = getHeadArtifact(getDb(), id, 'requirements');
    if (head === undefined) throw new Error('no artifact');

    decideArtifact(getDb(), {
      specId: id,
      kind: 'requirements',
      contentHash: head.contentHash,
      decision: 'request_changes',
      comment: 'Cover credit notes too.',
      actor: HUMAN,
      expectedVersion: spec(id).version,
    });

    expect(spec(id).status).toBe('REQ_DRAFTING');

    // And the loop closes: the agent can be run again from there, which is the whole
    // point of sending it back.
    stub.reply({ output: REQUIREMENTS });

    const response = await requirementsDraft.POST(
      req(`/api/specs/${id}/requirements/draft`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: spec(id).version,
          idempotency_key: 'reject-draft-2',
        }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(200);
    expect(spec(id).status).toBe('REQ_AWAITING_APPROVAL');
  });
});

describe('the spend ceiling', () => {
  it('refuses before the call when the cap is already reached', async () => {
    const previous = process.env['SDD_RUN_COST_CAP_USD'];
    process.env['SDD_RUN_COST_CAP_USD'] = '0.0000001';

    try {
      const id = newSpec('Over budget');
      const callsBefore = stub.calls.length;

      const payload = await body(
        await requirementsDraft.POST(
          req(`/api/specs/${id}/requirements/draft`, {
            method: 'POST',
            body: JSON.stringify({
              expected_version: spec(id).version,
              idempotency_key: 'over-budget-1',
            }),
          }),
          { params: Promise.resolve({ id }) },
        ),
        402,
      );

      expect(errorCode(payload)).toBe('BUDGET_EXCEEDED');
      // The ceiling is a ceiling: nothing was sent, so nothing was spent.
      expect(stub.calls).toHaveLength(callsBefore);
    } finally {
      if (previous === undefined) delete process.env['SDD_RUN_COST_CAP_USD'];
      else process.env['SDD_RUN_COST_CAP_USD'] = previous;
    }
  });
});

describe('a spec that does not exist', () => {
  it('is a 404, not a 500', async () => {
    const payload = await body(
      await requirementsDraft.POST(
        req('/api/specs/spec_nope/requirements/draft', {
          method: 'POST',
          body: JSON.stringify({
            expected_version: 0,
            idempotency_key: 'missing-spec-1',
          }),
        }),
        { params: Promise.resolve({ id: 'spec_nope' }) },
      ),
      404,
    );

    expect(errorCode(payload)).toBe('NOT_FOUND');
  });
});
