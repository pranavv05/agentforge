import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentForgeError } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import { createSpec, getCostSummary, type Actor } from '@agentforge/orchestrator';
import { z } from 'zod';
import { complete } from '../src/index.ts';
import { installStub, type Stub } from './stub.ts';

/**
 * The Claude client wrapper.
 *
 * What matters here is not that a request is sent, but that the five guarantees the
 * wrapper exists to provide actually hold on every path: structured output is
 * validated, the budget is enforced before the call, the cache prefix is assembled
 * correctly, spend is recorded, and failures are classified rather than swallowed.
 */

const ProposalSchema = z.strictObject({
  summary: z.string().min(1).max(200),
  items: z.array(z.strictObject({ id: z.string(), weight: z.number().int() })).max(5),
});

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

let dir: string;
let db: Db;
let stub: Stub;
let specId: string;

const VALID = { summary: 'A valid proposal.', items: [{ id: 'a', weight: 1 }] };

/** Issues a request with sensible defaults, overridable per test. */
async function run(
  overrides: Partial<Parameters<typeof complete<z.infer<typeof ProposalSchema>>>[0]> = {},
) {
  return await complete({
    db,
    specId,
    stage: 'requirements',
    correlationId: 'run_client_test',
    schema: ProposalSchema,
    schemaName: 'proposal',
    sections: [
      { name: 'skill', text: 'You are a test agent. Follow the schema.', stable: true },
      { name: 'request', text: 'Feature: export invoices.', stable: false },
    ],
    userMessage: 'Produce the proposal.',
    ...overrides,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-llm-'));
  db = createDb(join(dir, 'llm.db'));
  process.env['SDD_RUN_COST_CAP_USD'] = '2.00';
  process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-haiku-5-5';
  delete process.env['SDD_EFFORT_OVERRIDE'];

  specId = createSpec(db, {
    title: 'Test spec',
    description: 'For exercising the client wrapper.',
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
  delete process.env['SDD_RUN_COST_CAP_USD'];
  delete process.env['SDD_MODEL_REQUIREMENTS'];
});

describe('structured output', () => {
  it('returns validated output and records the call', async () => {
    stub.reply({ output: VALID });

    const result = await run();

    expect(result.output).toEqual(VALID);
    expect(result.model).toBe('claude-haiku-5-5');
    expect(result.fromCassette).toBe(false);
    expect(result.costUsd).toBeGreaterThan(0);

    const cost = getCostSummary(db, specId);
    expect(cost.call_count).toBe(1);
    expect(cost.total_cache_read_tokens).toBe(9_000);
  });

  it('asks the API for the schema, so the model is constrained server-side', async () => {
    stub.reply({ output: VALID });
    await run();

    const schema = stub.calls[0]?.schema as { additionalProperties?: boolean } | undefined;
    // `additionalProperties: false` is what makes the shape a guarantee rather than a hope.
    expect(schema?.additionalProperties).toBe(false);
  });

  it('rejects output that matches the JSON schema but violates contract bounds', async () => {
    // The JSON-schema conversion moves string lengths and array sizes into
    // descriptions, so the API does not enforce them. This local re-check does.
    stub.reply({ output: { summary: 'x'.repeat(500), items: [] } });

    try {
      await run();
      throw new Error('expected validation to fail');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.message).toContain('violated the contract constraints');
    }
  });

  it('fails when the model returns no parseable output', async () => {
    stub.reply({ output: null });

    try {
      await run();
      throw new Error('expected an upstream failure');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('UPSTREAM_FAILED');
    }
  });

  it('records no spend when the call fails validation', async () => {
    stub.reply({ output: { summary: '', items: [] } });
    await expect(run()).rejects.toThrow();

    // Nothing is charged for a response we refused, and nothing is logged as success.
    expect(getCostSummary(db, specId).call_count).toBe(0);
  });
});

describe('prompt assembly and caching', () => {
  it('places exactly one cache breakpoint, on the last stable block', async () => {
    stub.reply({ output: VALID });
    await run({
      sections: [
        { name: 'skill', text: 'stable one', stable: true },
        { name: 'pack', text: 'stable two', stable: true },
        { name: 'request', text: 'volatile', stable: false },
      ],
    });

    const system = stub.calls[0]?.system ?? [];
    expect(system.map((b) => b.text)).toEqual(['stable one', 'stable two', 'volatile']);

    const cached = system.filter((b) => b.cache_control !== undefined);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.text).toBe('stable two');
  });

  it('keeps the stable prefix byte-identical across calls with different requests', async () => {
    stub.reply({ output: VALID });
    stub.reply({ output: VALID });

    const stable = { name: 'skill', text: 'the stable instructions', stable: true } as const;
    await run({ sections: [stable, { name: 'request', text: 'first', stable: false }] });
    await run({ sections: [stable, { name: 'request', text: 'second', stable: false }] });

    // The cached prefix must not vary, or every request pays full price.
    expect(stub.calls[0]?.system[0]).toEqual(stub.calls[1]?.system[0]);
    expect(stub.calls[0]?.system[1]?.text).not.toBe(stub.calls[1]?.system[1]?.text);
  });

  it('refuses a stable section containing a per-request value', async () => {
    stub.reply({ output: VALID });

    // A timestamp in the prefix is the classic silent cache killer: the request still
    // succeeds, just at ten times the price. Better to fail loudly.
    await expect(
      run({
        sections: [
          { name: 'skill', text: `Generated at 2026-11-09T10:00:00Z`, stable: true },
          { name: 'request', text: 'go', stable: false },
        ],
      }),
    ).rejects.toThrow(/marked stable but contains a ISO timestamp/);
  });

  it('refuses a stable section containing a correlation id', async () => {
    stub.reply({ output: VALID });
    await expect(
      run({
        sections: [{ name: 'skill', text: 'run_mw94jmzl9c74b3c4 context', stable: true }],
      }),
    ).rejects.toThrow(/correlation id/);
  });

  it('drops empty sections rather than emitting empty blocks', async () => {
    stub.reply({ output: VALID });
    await run({
      sections: [
        { name: 'skill', text: 'real', stable: true },
        { name: 'evidence', text: '', stable: true },
        { name: 'request', text: 'go', stable: false },
      ],
    });

    const system = stub.calls[0]?.system ?? [];
    expect(system).toHaveLength(2);
    // The breakpoint must land on real content, not on a blank block.
    expect(system[0]?.cache_control).toBeDefined();
  });
});

describe('model and effort selection', () => {
  it('reads the model from the stage env var', async () => {
    process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-sonnet-5-5';
    stub.reply({ output: VALID });

    const result = await run();
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(stub.calls[0]?.model).toBe('claude-sonnet-5-5');
  });

  it('refuses a model with no pricing entry rather than running unmeasured', async () => {
    process.env['SDD_MODEL_REQUIREMENTS'] = 'claude-some-future-model';
    stub.reply({ output: VALID });

    await expect(run()).rejects.toThrow(/no entry in MODEL_PRICING/);
  });

  it('sends an explicit effort rather than relying on the model default', async () => {
    // The defaults differ by model (Haiku medium, Sonnet high), so leaving it unset
    // would make behaviour depend on which model happens to be configured.
    stub.reply({ output: VALID });
    await run();
    expect(stub.calls[0]?.effort).toBe('high');
  });

  it('honours an effort override', async () => {
    process.env['SDD_EFFORT_OVERRIDE'] = 'low';
    stub.reply({ output: VALID });
    await run();
    expect(stub.calls[0]?.effort).toBe('low');
    delete process.env['SDD_EFFORT_OVERRIDE'];
  });

  it('never sends a thinking budget, which the current models reject', async () => {
    stub.reply({ output: VALID });
    await run();
    // Captured params carry no `thinking` key at all: adaptive is the default on these
    // models, and an explicit budget or `disabled` would be a 400.
    expect(stub.calls[0]).not.toHaveProperty('thinking');
  });
});

describe('budget enforcement', () => {
  it('refuses the call when the run has already spent its ceiling', async () => {
    process.env['SDD_RUN_COST_CAP_USD'] = '0.0000001';
    stub.reply({ output: VALID });

    try {
      await run();
      throw new Error('expected the budget check to refuse');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('BUDGET_EXCEEDED');
    }

    // Refused before the request: the stub was never called.
    expect(stub.calls).toHaveLength(0);
  });

  it('skips the per-spec budget check when there is no spec', async () => {
    stub.reply({ output: VALID });
    const result = await run({ specId: null });
    expect(result.output).toEqual(VALID);
  });

  it('refuses a prompt above the token ceiling before sending it', async () => {
    process.env['SDD_MAX_PROMPT_TOKENS'] = '100';
    stub.reply({ output: VALID });

    await expect(
      run({ sections: [{ name: 'skill', text: 'x'.repeat(10_000), stable: true }] }),
    ).rejects.toThrow(/above the 100 ceiling/);

    expect(stub.calls).toHaveLength(0);
    delete process.env['SDD_MAX_PROMPT_TOKENS'];
  });
});

describe('failure classification', () => {
  it('maps a rate limit to UPSTREAM_FAILED', async () => {
    stub.reply({
      error: new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers()),
    });

    try {
      await run();
      throw new Error('expected an upstream failure');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('UPSTREAM_FAILED');
      expect(e.status).toBe(502);
      expect(e.message).toContain('rate limit');
    }
  });

  it('reports a refusal with its category instead of returning empty output', async () => {
    stub.reply({
      output: null,
      stopReason: 'refusal',
      stopDetails: { category: 'cyber', explanation: 'declined' },
    });

    try {
      await run();
      throw new Error('expected a refusal to surface');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('UPSTREAM_FAILED');
      expect(e.message).toContain('declined this request');
      expect(e.message).toContain('cyber');
    }
  });

  it('reports a truncated response rather than accepting partial output', async () => {
    stub.reply({ output: VALID, stopReason: 'max_tokens' });

    // The output would parse, but it was cut off, so trusting it would silently accept
    // an incomplete document.
    await expect(run()).rejects.toThrow(/output ceiling before finishing/);
  });

  it('surfaces a missing API key as a clear instruction, not a crash', async () => {
    stub.restore();
    delete process.env['ANTHROPIC_API_KEY'];

    try {
      await run();
      throw new Error('expected a clear upstream error');
    } catch (error) {
      const e = error as AgentForgeError;
      expect(e.code).toBe('UPSTREAM_FAILED');
      expect(e.message).toContain('SDD_CASSETTE_MODE=replay');
    }

    stub = installStub();
  });
});
