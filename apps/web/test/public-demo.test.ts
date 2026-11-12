import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '@agentforge/db';
import { TRANSITION_RULES } from '@agentforge/orchestrator';
import {
  SAMPLE_FILES,
  checkTransition,
  computeTds,
  hookVerdict,
  lintText,
  sampleExamples,
  sampleFile,
  statesPayload,
  verifyClaim,
} from '@/lib/site/public-demo';

/**
 * The public demos on the marketing site.
 *
 * These matter more than a marketing page usually would, because each one *asserts* a
 * governance claim in front of a visitor: that an agent cannot approve, that the hook
 * refuses an edit before release, that the pack catches a dissolved tax section. A demo
 * that drifted from the real behaviour would be the most visible possible way to be
 * wrong about this project's central argument.
 *
 * So the tests here check two things: that each demo answers correctly, and that it is
 * reading the shipped data rather than a copy of it.
 */

describe('the transition explorer', () => {
  it('offers the real table, not a retelling of it', () => {
    const payload = statesPayload();

    // Edge for edge. If a rule is added and the demo is not regenerated, this fails.
    expect(payload.edges).toHaveLength(TRANSITION_RULES.length);
    for (const rule of TRANSITION_RULES) {
      expect(
        payload.edges.some((edge) => edge.from === rule.from && edge.to === rule.to),
        `${rule.from} -> ${rule.to} missing from the demo`,
      ).toBe(true);
    }
  });

  it('shows every state somewhere in the pipeline groups', () => {
    const payload = statesPayload();
    const grouped = new Set(payload.pipeline.flatMap((group) => group.states));

    // A state missing from the grouping would simply not render, and the explorer would
    // quietly show a smaller machine than the product has.
    for (const state of payload.states) {
      expect(grouped.has(state), `${state} is in no pipeline group`).toBe(true);
    }
  });

  it('refuses an agent on an approval edge', () => {
    const result = checkTransition({
      from: 'REQ_AWAITING_APPROVAL',
      to: 'REQ_APPROVED',
      actor: 'agent',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_actor');
    expect(result.message).toContain('only a human');
  });

  it('allows a human on the same edge', () => {
    expect(
      checkTransition({ from: 'REQ_AWAITING_APPROVAL', to: 'REQ_APPROVED', actor: 'human' }).ok,
    ).toBe(true);
  });

  it('names the legal moves when the edge does not exist', () => {
    const result = checkTransition({ from: 'CREATED', to: 'DONE', actor: 'human' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_in_table');
    // Refusing without saying what *is* possible would make the explorer a dead end.
    expect(result.next.length).toBeGreaterThan(0);
  });
});

describe('the edit-hook tester', () => {
  it('denies a write before release', () => {
    const verdict = hookVerdict({ status: 'REQ_DRAFTING', tool: 'Write' });

    expect(verdict.decision).toBe('deny');
    expect(verdict.exit_code).toBe(2);
  });

  it('allows a write once released', () => {
    expect(hookVerdict({ status: 'READY_FOR_IMPLEMENTATION', tool: 'Edit' }).decision).toBe(
      'allow',
    );
    expect(hookVerdict({ status: 'IMPLEMENTING', tool: 'Edit' }).decision).toBe('allow');
  });

  it('never blocks a tool that cannot modify a file', () => {
    for (const state of ['CREATED', 'REQ_DRAFTING', 'DONE']) {
      expect(hookVerdict({ status: state, tool: 'Read' }).decision).toBe('allow');
      expect(hookVerdict({ status: state, tool: 'Grep' }).decision).toBe('allow');
    }
  });

  it('denies every governed tool in every pre-release state', () => {
    const released = ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING'];
    const before = statesPayload().states.filter((s) => !released.includes(s) && s !== 'DONE');

    for (const state of before) {
      for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
        expect(hookVerdict({ status: state, tool }).decision, `${tool} in ${state}`).toBe('deny');
      }
    }
  });
});

describe('the compliance lint', () => {
  it('catches a dissolved section and names its replacement', () => {
    const result = lintText('Deduct TDS under Section 194J for professional fees.');

    expect(result.ok).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.match).toMatch(/194\s*-?\s*J/i);
    expect(result.hits[0]?.replacement).toContain('393');
  });

  it('passes text that cites Section 393', () => {
    expect(lintText('Deduct TDS under Section 393, code 1027.').ok).toBe(true);
  });

  it('reports the pack version it judged against', () => {
    // Without this the verdict is unattributable: rules change between pack versions.
    expect(lintText('anything').pack_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('the TDS calculator', () => {
  it('applies the professional-services row', () => {
    const result = computeTds({ category: 'professional', payee: 'company', amount: 100_000 });

    expect(result.rate).toBe(10);
    expect(result.code).toBe('1027');
    expect(result.tds).toBe(10_000);
    expect(result.net).toBe(90_000);
  });

  it('splits the contractor rate by payee', () => {
    const individual = computeTds({ category: 'contractor', payee: 'individual', amount: 100_000 });
    const company = computeTds({ category: 'contractor', payee: 'company', amount: 100_000 });

    expect(individual.rate).toBe(1);
    expect(company.rate).toBe(2);
  });

  it('says out loud what it does not do', () => {
    const result = computeTds({ category: 'technical', payee: 'company', amount: 50_000 });

    // The calculator answers "what rate and code", not "is this payment liable". A tool
    // that implied the second would be exactly the confident wrong answer this project
    // argues against.
    expect(result.note).toContain('Thresholds are not applied');
    expect(result.note).toContain('not been reviewed by a tax professional');
  });
});

describe('the grounding playground', () => {
  it('only reads files on the allowlist', () => {
    // The endpoint is public and unauthenticated, so the set of readable paths is closed
    // rather than confined. There is no traversal to reason about.
    expect(sampleFile('packages/db/src/client.ts')).toBeNull();
    expect(sampleFile('../../../etc/passwd')).toBeNull();
    expect(sampleFile('.env')).toBeNull();
  });

  it('lists only files that actually exist', () => {
    for (const path of SAMPLE_FILES) {
      expect(existsSync(resolve(REPO_ROOT, path)), `${path} is listed but missing`).toBe(true);
    }
  });

  it('verifies a true claim about real source', () => {
    const file = sampleFile('packages/contract/src/states.ts');
    if (file === null) throw new Error('sample file missing');

    const line = file.content.split('\n').findIndex((l) => l.includes('SPEC_STATES')) + 1;

    const result = verifyClaim({
      file: 'packages/contract/src/states.ts',
      line_start: line,
      line_end: line,
      symbol: 'SPEC_STATES',
    });

    expect(result.verdict.ok).toBe(true);
  });

  it('refuses an invented file', () => {
    const result = verifyClaim({
      file: 'packages/tax/src/section393.ts',
      line_start: 1,
      line_end: 10,
      symbol: 'computeSection393',
    });

    expect(result.verdict.reason).toBe('file_not_found');
  });

  it('refuses a range past the end of the file', () => {
    const result = verifyClaim({
      file: 'packages/contract/src/states.ts',
      line_start: 1,
      line_end: 100_000,
      symbol: 'SPEC_STATES',
    });

    expect(result.verdict.reason).toBe('line_range_past_eof');
  });

  it('offers four worked examples that each do what their label says', () => {
    // The whole demo rests on these four. A hardcoded line number would be right the
    // day it was written and wrong a week later, so they are computed from the source
    // and checked here — a grounding playground whose own "true claim" has gone stale
    // would be a uniquely bad advertisement for a grounding verifier.
    const ex = sampleExamples();

    const claim = (e: { f: string; s: number; e: number; y: string }) =>
      verifyClaim({ file: e.f, line_start: e.s, line_end: e.e, symbol: e.y });

    expect(claim(ex.true_claim).verdict).toEqual({ ok: true, reason: 'verified' });
    expect(claim(ex.invented_file).verdict.reason).toBe('file_not_found');
    expect(claim(ex.out_of_range).verdict.reason).toBe('line_range_past_eof');
    expect(claim(ex.wrong_place).verdict.reason).toBe('symbol_not_in_range');
  });

  it('points at the real location when the symbol is elsewhere', () => {
    const result = verifyClaim({
      file: 'packages/contract/src/states.ts',
      line_start: 1,
      line_end: 2,
      symbol: 'SPEC_STATES',
    });

    expect(result.verdict.reason).toBe('symbol_not_in_range');
    // A failure that also says where the symbol is turns a complaint into a correction.
    expect(result.explain?.alt).not.toBeNull();
  });
});
