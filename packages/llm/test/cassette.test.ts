import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentForgeError } from '@agentforge/contract';
import { createDb, schema, type Db } from '@agentforge/db';
import { createSpec, getCostSummary, type Actor } from '@agentforge/orchestrator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CassetteSchema, cassetteDir, complete, listCassettes } from '../src/index.ts';
import { installStub, type Stub } from './stub.ts';

/**
 * Cassette record and replay.
 *
 * This is what makes the agent suite offline and deterministic, so it gets run. Two
 * properties matter beyond the round trip:
 *
 * - a replayed call still appears in `llm_calls`, at zero cost, so a replayed run and a
 *   live run have the same shape in the audit trail;
 * - a prompt change misses the cassette rather than silently passing against a stale
 *   recording. A test that kept passing after a prompt edit would be worse than no test.
 */

const ProposalSchema = z.strictObject({
  summary: z.string().min(1).max(200),
  count: z.number().int().nonnegative(),
});

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };
const OUTPUT = { summary: 'Recorded proposal.', count: 3 };

let dir: string;
let db: Db;
let stub: Stub;
let specId: string;

async function run(sectionText = 'stable instructions') {
  return await complete({
    db,
    specId,
    stage: 'requirements',
    correlationId: 'run_cassette_test',
    schema: ProposalSchema,
    schemaName: 'proposal',
    sections: [
      { name: 'skill', text: sectionText, stable: true },
      { name: 'request', text: 'Feature: export invoices.', stable: false },
    ],
    userMessage: 'Produce the proposal.',
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-cassette-'));
  db = createDb(join(dir, 'c.db'));
  process.env['SDD_CASSETTE_DIR'] = join(dir, 'cassettes');
  process.env['SDD_RUN_COST_CAP_USD'] = '2.00';
  process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-haiku-5-5';

  specId = createSpec(db, {
    title: 'Cassette spec',
    description: 'For exercising record and replay.',
    mode: 'greenfield',
    repo_path: null,
    actor: HUMAN,
  }).id;

  stub = installStub();
});

afterEach(() => {
  stub.restore();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env['SDD_CASSETTE_DIR'];
  delete process.env['SDD_RUN_COST_CAP_USD'];
  delete process.env['SDD_MODEL_REQUIREMENTS'];
});

describe('recording', () => {
  it('writes a cassette marked as recorded', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });

    await run();

    const keys = listCassettes();
    expect(keys).toHaveLength(1);

    const key = keys[0];
    if (key === undefined) throw new Error('expected a cassette');

    const cassette = CassetteSchema.parse(
      JSON.parse(readFileSync(join(cassetteDir(), `${key}.json`), 'utf8')),
    );

    expect(cassette.source).toBe('recorded');
    expect(cassette.output).toEqual(OUTPUT);
    expect(cassette.model).toBe('claude-haiku-5-5');
    expect(cassette.label).toBe('requirements:proposal');
    expect(cassette.usage.cache_read_input_tokens).toBe(9_000);
  });

  it('does not write a cassette when the mode is off', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'off';
    stub.reply({ output: OUTPUT });

    await run();
    expect(listCassettes()).toEqual([]);
  });
});

describe('replaying', () => {
  it('returns the recorded output without calling the API', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });
    await run();
    const callsAfterRecord = stub.calls.length;

    process.env['SDD_CASSETTE_MODE'] = 'replay';
    const replayed = await run();

    expect(replayed.output).toEqual(OUTPUT);
    expect(replayed.fromCassette).toBe(true);
    expect(replayed.costUsd).toBe(0);
    // No second request was issued.
    expect(stub.calls).toHaveLength(callsAfterRecord);
  });

  it('still records the replayed call, at zero cost', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });
    await run();

    const afterRecord = getCostSummary(db, specId);
    expect(afterRecord.call_count).toBe(1);
    expect(afterRecord.total_cost_usd).toBeGreaterThan(0);

    process.env['SDD_CASSETTE_MODE'] = 'replay';
    await run();

    const afterReplay = getCostSummary(db, specId);
    expect(afterReplay.call_count).toBe(2);
    // The replay added a row but no spend, so the audit trail is complete and the cost
    // figures stay honest.
    expect(afterReplay.total_cost_usd).toBeCloseTo(afterRecord.total_cost_usd, 12);

    const rows = db
      .select({ fromCassette: schema.llmCalls.fromCassette })
      .from(schema.llmCalls)
      .where(eq(schema.llmCalls.specId, specId))
      .all();
    expect(rows.map((r) => r.fromCassette).sort()).toEqual([0, 1]);
  });

  it('misses the cassette when the prompt changes', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });
    await run('stable instructions');

    process.env['SDD_CASSETTE_MODE'] = 'replay';

    // An edited prompt must not keep passing against the old recording.
    try {
      await run('stable instructions, revised');
      throw new Error('expected a cassette miss');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.message).toContain('no cassette recorded');
      expect(e.message).toContain('SDD_CASSETTE_MODE=record');
    }
  });

  it('misses the cassette when the model changes', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });
    await run();

    process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-sonnet-5-5';
    process.env['SDD_CASSETTE_MODE'] = 'replay';

    // Output is model-dependent, so a recording from one model is not evidence for another.
    await expect(run()).rejects.toThrow(/no cassette recorded/);
  });

  it('reports a clear error when nothing is recorded at all', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'replay';
    await expect(run()).rejects.toThrow(/no cassette recorded for this request/);
  });

  it('rejects a cassette whose output no longer matches the schema', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'record';
    stub.reply({ output: OUTPUT });
    await run();

    // Simulate a schema change after recording: the fixture on disk is now stale.
    const key = listCassettes()[0];
    if (key === undefined) throw new Error('expected a cassette');
    const path = join(cassetteDir(), `${key}.json`);
    const cassette = CassetteSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    rmSync(path);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      path,
      JSON.stringify({ ...cassette, output: { summary: 'ok', count: -1 } }, null, 2),
    );

    process.env['SDD_CASSETTE_MODE'] = 'replay';

    // A cassette is a file on disk, so it is validated like any other untrusted input.
    await expect(run()).rejects.toThrow(/no longer matches the schema; re-record it/);
  });
});

describe('mode validation', () => {
  it('rejects an unknown cassette mode rather than guessing', async () => {
    process.env['SDD_CASSETTE_MODE'] = 'maybe';
    stub.reply({ output: OUTPUT });

    await expect(run()).rejects.toThrow(/SDD_CASSETTE_MODE must be one of/);
  });
});
