import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentForgeError } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import { createSpec, getCostSummary, type Actor } from '@agentforge/orchestrator';
import { runToolLoop, type LoopTool } from '../src/index.ts';
import { installStub, type Stub } from './stub.ts';

/**
 * The agentic loop's budget.
 *
 * The loop is the one part of the system whose cost is not bounded by its input — the
 * model decides how many searches to make. So the caps are the feature, and these tests
 * drive each one to its limit:
 *
 * - the tool-call ceiling stops the loop and still gets a summary out of it;
 * - a tool that throws is reported to the model rather than ending the run;
 * - every turn is recorded in `llm_calls`, so a run that hit its ceiling is visible
 *   afterwards rather than merely having failed.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

const ECHO: LoopTool = {
  name: 'echo',
  description: 'Returns whatever it is given, for testing the loop rather than a tool.',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
};

let db: Db;
let dir: string;
let specId: string;
let stub: Stub;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-loop-'));
  db = createDb(join(dir, 'test.db'));
  specId = createSpec(db, {
    title: 'Loop under test',
    description: 'A spec that exists only to own the cost rows the loop writes.',
    mode: 'brownfield',
    repo_path: dir,
    actor: HUMAN,
  }).id;
  stub = installStub();
});

afterEach(() => {
  stub.restore();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const baseRequest = {
  stage: 'context_loop' as const,
  correlationId: 'corr_loop_test',
  sections: [{ name: 'skill:test', text: 'You are a test.', stable: true }],
  userMessage: 'Explore.',
  tools: [ECHO],
};

describe('a loop that finishes on its own', () => {
  it('stops at the first turn with no tool calls and keeps the closing text', async () => {
    stub.reply({ output: null, toolUses: [{ name: 'echo', input: { value: 'one' } }] });
    stub.reply({ output: null, text: 'I looked at one thing and that was enough.' });

    const result = await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 10,
      execute: (invocation) => `echoed ${JSON.stringify(invocation.input)}`,
    });

    expect(result.toolCallsUsed).toBe(1);
    expect(result.budgetExhausted).toBe(false);
    expect(result.summary).toBe('I looked at one thing and that was enough.');
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0]?.result).toContain('echoed');
  });

  it('records every turn as its own llm_calls row', async () => {
    stub.reply({ output: null, toolUses: [{ name: 'echo', input: {} }] });
    stub.reply({ output: null, text: 'done' });

    await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 5,
      execute: () => 'ok',
    });

    // Two model turns, two rows. Per-feature cost comes from this table, so a loop that
    // billed twice and recorded once would understate every figure in the report.
    expect(getCostSummary(db, specId).call_count).toBe(2);
  });

  it('passes the offered tools through to the request', async () => {
    stub.reply({ output: null, text: 'nothing to do' });

    await runToolLoop({ db, specId, ...baseRequest, maxToolCalls: 5, execute: () => 'ok' });

    expect(stub.calls[0]?.toolNames).toEqual(['echo']);
    // A request carrying tools must not also carry a schema: the two cannot be combined,
    // and sending both is a 400. This is the assertion that keeps the split honest.
    expect(stub.calls[0]?.schema).toBeUndefined();
  });
});

describe('the tool-call ceiling', () => {
  it('stops at the cap and still produces a summary', async () => {
    // Three turns each asking for one call, but the cap is two: the third request is
    // refused, which is what triggers the closing turn.
    for (let i = 0; i < 3; i += 1) {
      stub.reply({ output: null, toolUses: [{ name: 'echo', input: { value: String(i) } }] });
    }
    // The closing turn the loop asks for once the budget is spent.
    stub.reply({ output: null, text: 'Budget spent; here is what I found.' });

    const result = await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 2,
      execute: () => 'ok',
    });

    expect(result.toolCallsUsed).toBe(2);
    expect(result.budgetExhausted).toBe(true);
    // The point of the closing turn: a cut-off run returns findings, not nothing.
    expect(result.summary).toBe('Budget spent; here is what I found.');
  });

  it('counts calls across a turn that asks for several at once', async () => {
    stub.reply({
      output: null,
      toolUses: [
        { name: 'echo', input: { value: 'a' } },
        { name: 'echo', input: { value: 'b' } },
        { name: 'echo', input: { value: 'c' } },
      ],
    });
    stub.reply({ output: null, text: 'stopped' });

    const result = await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 2,
      execute: () => 'ok',
    });

    // Three were requested in one turn; only two were run. A parallel turn must not be
    // a way around the cap.
    expect(result.toolCallsUsed).toBe(2);
    expect(result.budgetExhausted).toBe(true);
  });

  it('reports progress so a budget bar can be drawn', async () => {
    stub.reply({
      output: null,
      toolUses: [
        { name: 'echo', input: {} },
        { name: 'echo', input: {} },
      ],
    });
    stub.reply({ output: null, text: 'done' });

    const seen: number[] = [];
    await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 10,
      execute: () => 'ok',
      onToolCall: (invocation) => seen.push(invocation.index),
    });

    expect(seen).toEqual([1, 2]);
  });

  it('refuses a cap below one rather than looping forever', async () => {
    await expect(
      runToolLoop({ db, specId, ...baseRequest, maxToolCalls: 0, execute: () => 'ok' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a loop with no tools', async () => {
    await expect(
      runToolLoop({ db, specId, ...baseRequest, tools: [], maxToolCalls: 5, execute: () => 'ok' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('a tool that fails', () => {
  it('reports the failure to the model and keeps going', async () => {
    stub.reply({ output: null, toolUses: [{ name: 'echo', input: { value: 'boom' } }] });
    stub.reply({ output: null, toolUses: [{ name: 'echo', input: { value: 'retry' } }] });
    stub.reply({ output: null, text: 'recovered' });

    let attempt = 0;
    const result = await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 5,
      execute: () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk on fire');
        return 'second time lucky';
      },
    });

    // The whole point: a failed tool call is information the model can act on. Aborting
    // would discard everything found before the failure.
    expect(result.summary).toBe('recovered');
    expect(result.transcript[0]?.result).toContain('disk on fire');
    expect(result.transcript[1]?.result).toBe('second time lucky');
  });

  it('truncates an enormous tool result rather than blowing the prompt', async () => {
    stub.reply({ output: null, toolUses: [{ name: 'echo', input: {} }] });
    stub.reply({ output: null, text: 'done' });

    const result = await runToolLoop({
      db,
      specId,
      ...baseRequest,
      maxToolCalls: 5,
      execute: () => 'x'.repeat(100_000),
    });

    const captured = result.transcript[0]?.result ?? '';
    expect(captured.length).toBeLessThan(100_000);
    expect(captured).toContain('truncated');
  });
});

describe('the prompt ceiling', () => {
  it('stops the loop when the conversation outgrows the ceiling', async () => {
    const previous = process.env['SDD_MAX_PROMPT_TOKENS'];
    // A ceiling small enough that one large tool result crosses it. The real value is
    // 100K, chosen because Haiku prices above that five times higher — the ceiling is a
    // cost cliff, not an arbitrary limit, so it has to actually stop the loop.
    process.env['SDD_MAX_PROMPT_TOKENS'] = '2000';

    try {
      stub.reply({ output: null, toolUses: [{ name: 'echo', input: {} }] });
      // Would be used if the loop wrongly continued.
      stub.reply({ output: null, toolUses: [{ name: 'echo', input: {} }] });
      stub.reply({ output: null, text: 'unreachable' });

      const result = await runToolLoop({
        db,
        specId,
        ...baseRequest,
        maxToolCalls: 10,
        execute: () => 'y'.repeat(19_000),
      });

      expect(result.budgetExhausted).toBe(true);
      expect(result.toolCallsUsed).toBe(1);
    } finally {
      if (previous === undefined) delete process.env['SDD_MAX_PROMPT_TOKENS'];
      else process.env['SDD_MAX_PROMPT_TOKENS'] = previous;
    }
  });
});

describe('the run budget', () => {
  it('refuses before the call when the spend cap is already reached', async () => {
    const previous = process.env['SDD_RUN_COST_CAP_USD'];
    process.env['SDD_RUN_COST_CAP_USD'] = '0.0000001';

    try {
      stub.reply({ output: null, text: 'never sent' });

      try {
        await runToolLoop({ db, specId, ...baseRequest, maxToolCalls: 5, execute: () => 'ok' });
        throw new Error('expected the budget to be refused');
      } catch (error) {
        expect((error as AgentForgeError).code).toBe('BUDGET_EXCEEDED');
      }

      // Refused *before* the call, so nothing was sent and nothing was billed.
      expect(stub.calls).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env['SDD_RUN_COST_CAP_USD'];
      else process.env['SDD_RUN_COST_CAP_USD'] = previous;
    }
  });
});
