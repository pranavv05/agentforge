import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentForgeError } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import {
  createSpec,
  getCostSummary,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  listEvidence,
  transition,
  type Actor,
} from '@agentforge/orchestrator';
import { installStub, type Stub } from '../../llm/test/stub.ts';
import { scanContext } from '../src/index.ts';
import { SAMPLE_REPO, makeFixture, type Fixture } from './fixtures.ts';

/**
 * Case B end to end: a brownfield spec from `CONTEXT_SCANNING` to `CONTEXT_READY`.
 *
 * The transport is stubbed and nothing else is. The inventory, the repo map, the FTS
 * index, the tools, the loop, the verifier, the evidence rows, the artifact write and
 * the transition all execute for real, which is what makes this a test of the pipeline
 * rather than a test of a mock.
 *
 * The load-bearing assertion is the one about an invented file: the agent is handed a
 * citation to a path that does not exist, and the unverified-claim rate has to catch it.
 * That number is the project's hallucination metric, so a test that only ever fed it
 * good citations would prove nothing.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

let fx: Fixture;
let db: Db;
let dbDir: string;
let specId: string;
let stub: Stub;

/** A claim that will verify: this symbol really is on these lines of the fixture. */
const GOOD_CLAIM = {
  file: 'src/billing/invoice.ts',
  line_start: 9,
  line_end: 12,
  symbol: 'finaliseInvoice',
  claim: 'Invoice finalisation runs through a single function.',
  relevance: 'The export must only accept a finalised invoice.',
};

/** A claim that cannot verify: there is no such file in the repository. */
const INVENTED_CLAIM = {
  file: 'src/billing/eInvoiceGateway.ts',
  line_start: 1,
  line_end: 20,
  symbol: 'submitToIrp',
  claim: 'An IRP gateway already exists and handles submission.',
  relevance: 'Would mean the feature is mostly built.',
};

beforeEach(() => {
  fx = makeFixture(SAMPLE_REPO);
  dbDir = mkdtempSync(join(tmpdir(), 'agentforge-ctxagent-'));
  db = createDb(join(dbDir, 'test.db'));

  const spec = createSpec(db, {
    title: 'GST e-invoice export',
    description: 'Export a finalised invoice as a GST e-invoice JSON payload for the IRP.',
    mode: 'brownfield',
    repo_path: fx.dir,
    actor: HUMAN,
  });
  specId = spec.id;

  transition(db, {
    specId,
    from: 'CREATED',
    to: 'CONTEXT_SCANNING',
    actor: { id: 'orchestrator', type: 'orchestrator' },
    expectedVersion: spec.version,
  });

  stub = installStub();
});

afterEach(() => {
  stub.restore();
  db.$client.close();
  rmSync(dbDir, { recursive: true, force: true });
  fx.cleanup();
});

/** Queues a minimal exploration: one real search, then the proposal. */
function queueRun(claims: readonly unknown[], options: { summary?: string } = {}): void {
  // The loop's single tool-use turn, then its closing text.
  stub.reply({ output: null, toolUses: [{ name: 'fts_search', input: { query: 'invoice' } }] });
  stub.reply({ output: null, text: 'Found the invoice module.' });

  // The separate, schema-constrained proposal call.
  stub.reply({
    output: {
      summary: options.summary ?? 'Invoices are finalised in the billing module.',
      claims,
      touched_modules: ['src/billing'],
      open_questions: [],
    },
  });
}

describe('the brownfield path', () => {
  it('reaches CONTEXT_READY with verified evidence', async () => {
    queueRun([GOOD_CLAIM]);

    const result = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-1',
      skipModuleSummaries: true,
    });

    expect(getSpec(db, specId)?.status).toBe('CONTEXT_READY');
    expect(result.bundle.stats.total_claims).toBe(1);
    expect(result.bundle.stats.verified_claims).toBe(1);
    expect(result.bundle.stats.unverified_claim_rate).toBe(0);
    expect(result.bundle.stats.retrieval_strategy).toBe('fts_repomap');

    const evidence = listEvidence(db, specId);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.verified).toBe(true);
    expect(evidence[0]?.file).toBe('src/billing/invoice.ts');
  });

  it('catches an invented file and reports it as an unverified claim', async () => {
    // This is the differentiator. The citation reads perfectly and would pass any human
    // skim of the document; only reading the filesystem catches it.
    queueRun([GOOD_CLAIM, INVENTED_CLAIM]);

    const result = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-invented',
      skipModuleSummaries: true,
    });

    expect(result.bundle.stats.total_claims).toBe(2);
    expect(result.bundle.stats.verified_claims).toBe(1);
    expect(result.bundle.stats.unverified_claims).toBe(1);
    expect(result.bundle.stats.unverified_claim_rate).toBe(0.5);

    const failed = listEvidence(db, specId).find((row) => !row.verified);
    expect(failed?.failure_reason).toBe('file_not_found');
    // Kept, not dropped: the rate needs its denominator, and a reviewer should see what
    // the agent asserted and why it did not hold up.
    expect(failed?.claim).toContain('IRP gateway');
  });

  it('catches a symbol that is not in the cited range', async () => {
    queueRun([
      {
        ...GOOD_CLAIM,
        // A real file and a real range, but this symbol is not on these lines.
        symbol: 'submitToIrp',
      },
    ]);

    const result = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-symbol',
      skipModuleSummaries: true,
    });

    expect(result.bundle.stats.unverified_claims).toBe(1);
    expect(listEvidence(db, specId)[0]?.failure_reason).toBe('symbol_not_in_range');
  });

  it('records the transition as the orchestrator, not the agent', async () => {
    queueRun([GOOD_CLAIM]);
    await scanContext(db, { specId, idempotencyKey: 'scan-actor', skipModuleSummaries: true });

    const entry = listAuditEntries(db, specId).find((row) => row.toState === 'CONTEXT_READY');
    expect(entry).toBeDefined();
    // The agent proposed; the orchestrator moved the spec. This separation is what lets
    // the audit log prove no agent advanced its own work.
    expect(entry?.actorType).toBe('orchestrator');

    // The artifact records the agent as its author, so the pair of rows together show
    // an agent wrote the content and something else moved the spec.
    const artifact = getHeadArtifact(db, specId, 'context');
    expect(artifact?.createdBy).toBe('context-agent');
  });

  it('writes a context artifact whose markdown shows the grounding result', async () => {
    queueRun([GOOD_CLAIM, INVENTED_CLAIM]);
    await scanContext(db, { specId, idempotencyKey: 'scan-md', skipModuleSummaries: true });

    const md = getHeadArtifact(db, specId, 'context')?.contentMd ?? '';
    expect(md).toContain('# Context: GST e-invoice export');
    expect(md).toContain('unverified-claim rate: 50.0%');
    expect(md).toContain('UNVERIFIED (file_not_found)');
    expect(md).toContain('src/billing/invoice.ts:9-12');
  });
});

describe('idempotency', () => {
  it('replays a completed scan instead of exploring again', async () => {
    queueRun([GOOD_CLAIM]);
    const first = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-same',
      skipModuleSummaries: true,
    });

    const callsAfterFirst = stub.calls.length;

    // No replies queued: if this re-explored, it would fail for want of a stub reply.
    const second = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-same',
      skipModuleSummaries: true,
    });

    expect(second.replayed).toBe(true);
    expect(second.bundle).toEqual(first.bundle);
    expect(second.costUsd).toBe(0);
    // A client timeout and retry must not pay for the scan twice.
    expect(stub.calls).toHaveLength(callsAfterFirst);
  });

  it('replays before checking state, so a retry after completion still works', async () => {
    queueRun([GOOD_CLAIM]);
    await scanContext(db, { specId, idempotencyKey: 'scan-order', skipModuleSummaries: true });

    // The spec has left CONTEXT_SCANNING, so the state guard would now refuse. The
    // replay check runs first precisely so a retry of completed work does not fail a
    // precondition on work that actually succeeded.
    const replayed = await scanContext(db, {
      specId,
      idempotencyKey: 'scan-order',
      skipModuleSummaries: true,
    });
    expect(replayed.replayed).toBe(true);
  });
});

describe('guards', () => {
  it('refuses a scan outside CONTEXT_SCANNING', async () => {
    queueRun([GOOD_CLAIM]);
    await scanContext(db, { specId, idempotencyKey: 'scan-guard-1', skipModuleSummaries: true });

    await expect(
      scanContext(db, { specId, idempotencyKey: 'scan-guard-2', skipModuleSummaries: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('refuses a greenfield spec, which has no repository to scan', async () => {
    const greenfield = createSpec(db, {
      title: 'Greenfield',
      description: 'No repository exists for this one.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    });

    await expect(
      scanContext(db, { specId: greenfield.id, idempotencyKey: 'scan-green' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('retrieval strategies', () => {
  it('gives the grep arm no repo map and no index', async () => {
    queueRun([GOOD_CLAIM]);
    // The grep arm has no fts_search, so the queued tool call is answered as an error
    // by the loop rather than executed — which is the behaviour under test elsewhere.
    await scanContext(db, {
      specId,
      idempotencyKey: 'scan-grep',
      strategy: 'grep',
      skipModuleSummaries: true,
    });

    const loopCall = stub.calls[0];
    expect(loopCall?.toolNames).toEqual(['grep', 'read_file', 'list_dir']);
    // An ablation arm has to be a real difference in capability, not a label: the
    // baseline must not be handed the repo map in its prompt either.
    const prompt = (loopCall?.system ?? []).map((block) => block.text).join('\n');
    expect(prompt).not.toContain('repo-map');
  });

  it('gives the full arm the map and the index', async () => {
    queueRun([GOOD_CLAIM]);
    await scanContext(db, {
      specId,
      idempotencyKey: 'scan-full',
      strategy: 'fts_repomap',
      skipModuleSummaries: true,
    });

    expect(stub.calls[0]?.toolNames).toEqual([
      'repo_map',
      'fts_search',
      'grep',
      'read_file',
      'list_dir',
    ]);
  });

  it('refuses the embedding arm rather than silently running a different one', async () => {
    // The contract names this arm because it was planned; it is not implemented. Serving
    // the fts_repomap tools under its name would put an arm in the results table that
    // was never measured.
    try {
      await scanContext(db, {
        specId,
        idempotencyKey: 'scan-embed',
        strategy: 'fts_repomap_embed',
        skipModuleSummaries: true,
      });
      throw new Error('expected the embedding arm to be refused');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
      expect((error as Error).message).toContain('not implemented');
    }
  });
});

describe('module summaries', () => {
  it('summarises modules once and re-uses them on the next scan', async () => {
    // One summary call for the one module the fixture has, then the loop and proposal.
    stub.reply({
      output: {
        purpose: 'Billing and orchestration source.',
        public_interface: ['finaliseInvoice'],
        depends_on: ['zod'],
      },
    });
    queueRun([GOOD_CLAIM]);

    const first = await scanContext(db, { specId, idempotencyKey: 'scan-mod-1' });
    expect(first.moduleSummaries).toHaveLength(1);
    expect(first.moduleSummaries[0]?.cached).toBe(false);
    expect(first.moduleSummaries[0]?.summaryMd).toContain('Billing and orchestration');

    // A second spec against the same repository: the summary is keyed on content, so
    // nothing should be re-summarised and no summary call should be made.
    const second = createSpec(db, {
      title: 'Second feature',
      description: 'Another feature against the same repository.',
      mode: 'brownfield',
      repo_path: fx.dir,
      actor: HUMAN,
    });
    transition(db, {
      specId: second.id,
      from: 'CREATED',
      to: 'CONTEXT_SCANNING',
      actor: { id: 'orchestrator', type: 'orchestrator' },
      expectedVersion: second.version,
    });

    const callsBefore = stub.calls.length;
    queueRun([GOOD_CLAIM]);
    const run = await scanContext(db, { specId: second.id, idempotencyKey: 'scan-mod-2' });

    // Two model calls for the loop and one for the proposal — and none for summaries.
    expect(stub.calls.length - callsBefore).toBe(3);
    expect(run.moduleSummaries[0]?.cached).toBe(true);
  });
});

describe('cost accounting', () => {
  it('records every call against the spec', async () => {
    queueRun([GOOD_CLAIM]);
    await scanContext(db, { specId, idempotencyKey: 'scan-cost', skipModuleSummaries: true });

    // Two loop turns plus the proposal call.
    expect(getCostSummary(db, specId).call_count).toBe(3);
    expect(getCostSummary(db, specId).total_cost_usd).toBeGreaterThan(0);
  });
});
