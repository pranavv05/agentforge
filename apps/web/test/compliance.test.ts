import { afterAll, describe, expect, it } from 'vitest';
// Types come from a static import: the `contract` below is a runtime namespace object
// from `await import`, so it cannot be used in a type position.
import type { SpecState } from '@agentforge/contract';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The compliance routes.
 *
 * Two behaviours matter at the HTTP boundary. The pack route must refuse to serve an
 * empty rule set, because "no rules" reads as "nothing to comply with" — the opposite
 * of the truth. And the trace route has to report *gaps*, since a rule that stops at a
 * requirement has been written down and not built, which is the whole point of
 * measuring coverage.
 */

const dir = mkdtempSync(join(tmpdir(), 'agentforge-web-compliance-'));
process.env['SDD_DB_PATH'] = join(dir, 'compliance.db');
process.env['SDD_RUN_COST_CAP_USD'] = '2.00';

const { getDb, closeDb } = await import('@agentforge/db');
const {
  createSpec,
  decideArtifact,
  getHeadArtifact,
  getSpec,
  syncTasks,
  transition,
  writeArtifact,
} = await import('@agentforge/orchestrator');
const { loadPack, PACK_VERSION } = await import('@agentforge/compliance');
const contract = await import('@agentforge/contract');

const packRoute = await import('@/app/api/compliance/pack/route');
const traceRoute = await import('@/app/api/specs/[id]/compliance/trace/route');

const HUMAN = { id: 'reviewer@example.com', type: 'human' } as const;
const ORCHESTRATOR = { id: 'orchestrator', type: 'orchestrator' } as const;

async function json(response: Response, expectedStatus: number): Promise<unknown> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 400)).toBe(expectedStatus);
  return body;
}

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/compliance/pack', () => {
  it('404s with a clear message before a pack is loaded', async () => {
    const body = await json(await packRoute.GET(), 404);
    expect(contract.ApiErrorSchema.parse(body).error.message).toContain(
      'no compliance pack has been loaded',
    );
  });

  it('serves the installed pack, with its citations and disclosures intact', async () => {
    expect(loadPack(getDb())).toBe(15);

    const parsed = contract.GetCompliancePackResponseSchema.parse(
      await json(await packRoute.GET(), 200),
    );

    expect(parsed.pack.version).toBe(PACK_VERSION);
    expect(parsed.pack.rules).toHaveLength(15);

    const tds001 = parsed.pack.rules.find((r) => r.key === 'TDS-001');
    expect(tds001?.citation).toContain('Section 393');
    expect(tds001?.superseded_terms.length).toBeGreaterThan(0);

    // The threshold disagreement must survive the round trip to the client: the report
    // depends on it being disclosed rather than silently resolved.
    const tds006 = parsed.pack.rules.find((r) => r.key === 'TDS-006');
    expect(tds006?.source_conflict_note).toContain('50,000');
  });
});

describe('GET /api/specs/:id/compliance/trace', () => {
  /** A spec with approved requirements citing a GST rule, plus a design and tasks. */
  function tracedSpec(): string {
    const spec = createSpec(getDb(), {
      title: 'GST invoice numbering series',
      description:
        'Give each financial year a gap-free invoice numbering series for GST compliance.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    const version = (): number => {
      const row = getSpec(getDb(), spec.id);
      if (row === undefined) throw new Error('spec vanished');
      return row.version;
    };
    const status = (): string => {
      const row = getSpec(getDb(), spec.id);
      if (row === undefined) throw new Error('spec vanished');
      return row.status;
    };

    const requirements = contract.RequirementsProposalSchema.parse({
      feature_summary: 'Gap-free invoice numbering per financial year.',
      requirements: [
        {
          id: 'REQ-001',
          ears_pattern: 'event_driven',
          ears_statement:
            'When an invoice is finalised, the system shall assign the next number in the series.',
          rationale: 'GST requires a consecutive series within a financial year.',
          priority: 'must',
          acceptance_criteria: [
            {
              id: 'AC-001',
              given: 'the last invoice of the year is numbered 41',
              when: 'another invoice is finalised',
              then: 'it is numbered 42',
              compliance_rule_key: 'GST-003',
            },
          ],
          source_refs: [],
          compliance_refs: ['GST-003'],
        },
      ],
      clarification_questions: [],
      non_goals: [],
    });

    const design = contract.DesignProposalSchema.parse({
      overview: 'A per-series counter allocated transactionally.',
      sections: [
        {
          id: 'DES-001',
          heading: 'Series counter',
          body: 'One row per financial year, incremented under the write lock.',
          source_refs: [],
          requirement_ids: ['REQ-001'],
        },
      ],
      decisions: [],
      risks: [],
    });

    const tasks = contract.TasksProposalSchema.parse({
      implementation_order_rationale: 'The counter lands first.',
      tasks: [
        {
          id: 'TASK-001',
          title: 'Add the counter table',
          description: 'Migration plus a transactional allocate().',
          status: 'pending',
          requirement_ids: ['REQ-001'],
          design_section_ids: ['DES-001'],
          source_refs: [],
          verifies: ['AC-001'],
          depends_on: [],
        },
      ],
    });

    const step = (to: SpecState, actor = ORCHESTRATOR): void => {
      transition(getDb(), {
        specId: spec.id,
        from: status() as SpecState,
        to,
        actor,
        expectedVersion: version(),
      });
    };

    const put = (kind: 'requirements' | 'design' | 'tasks', payload: unknown): void => {
      writeArtifact(getDb(), {
        specId: spec.id,
        kind,
        payload,
        contentMd: `# ${kind}\n`,
        actor: { id: `${kind}-agent`, type: 'agent' },
      });
    };

    const approve = (kind: 'requirements' | 'design'): void => {
      const head = getHeadArtifact(getDb(), spec.id, kind);
      if (head === undefined) throw new Error(`no ${kind} artifact`);
      decideArtifact(getDb(), {
        specId: spec.id,
        kind,
        contentHash: head.contentHash,
        decision: 'approve',
        actor: HUMAN,
        expectedVersion: version(),
      });
    };

    step('REQ_DRAFTING');
    put('requirements', requirements);
    step('REQ_AWAITING_APPROVAL');
    approve('requirements');
    step('DESIGN_DRAFTING');
    put('design', design);
    step('DESIGN_AWAITING_APPROVAL');
    approve('design');
    put('tasks', tasks);
    step('TASKS_GENERATED');
    syncTasks(getDb(), spec.id, tasks);

    return spec.id;
  }

  const get = async (specId: string) =>
    await traceRoute.GET(
      new Request(`http://localhost:3000/api/specs/${specId}/compliance/trace`),
      { params: Promise.resolve({ id: specId }) },
    );

  it('traces an applicable rule through to a task', async () => {
    const specId = tracedSpec();

    const parsed = contract.GetComplianceTraceResponseSchema.parse(
      await json(await get(specId), 200),
    );
    const coverage = parsed.coverage;

    expect(coverage.pack_version).toBe(PACK_VERSION);
    expect(coverage.applicable_rules).toBeGreaterThan(0);

    const traced = coverage.traces.find((t) => t.rule_key === 'GST-003');
    expect(traced).toMatchObject({
      requirement_id: 'REQ-001',
      acceptance_criterion_id: 'AC-001',
      design_section_id: 'DES-001',
      task_id: 'TASK-001',
    });
    // Not yet implemented, so no test reference: the honest state of the chain.
    expect(traced?.test_ref).toBeNull();
  });

  it('reports applicable rules that nothing references as gaps', async () => {
    const specId = tracedSpec();
    const coverage = contract.GetComplianceTraceResponseSchema.parse(
      await json(await get(specId), 200),
    ).coverage;

    // The invoicing feature matches several GST rules; only GST-003 was addressed, so
    // the rest must show as untraced rather than being omitted from the report.
    const untraced = coverage.traces.filter((t) => t.requirement_id === null);
    expect(untraced.length).toBeGreaterThan(0);
    expect(coverage.coverage_rate).toBeLessThan(1);
    expect(coverage.traced_to_task).toBeLessThan(coverage.applicable_rules);
  });

  it('returns an empty coverage report for a spec with no artifacts', async () => {
    const spec = createSpec(getDb(), {
      title: 'Dark mode toggle',
      description: 'Switch the interface between light and dark themes.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    const coverage = contract.GetComplianceTraceResponseSchema.parse(
      await json(await get(spec.id), 200),
    ).coverage;

    // Nothing about this feature touches GST or TDS, so attaching rules to it would be
    // noise. Zero applicable rules, and no divide-by-zero in the rate.
    expect(coverage.applicable_rules).toBe(0);
    expect(coverage.coverage_rate).toBe(0);
    expect(coverage.traces).toEqual([]);
  });

  it('404s for an unknown spec', async () => {
    const body = await json(await get('spec_nope'), 404);
    expect(contract.ApiErrorSchema.parse(body).error.code).toBe('NOT_FOUND');
  });
});
