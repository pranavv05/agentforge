import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContextEvidence } from '@agentforge/contract';
import { installStub, type Stub } from '../../llm/test/stub.ts';
import {
  AgenticRunRecordSchema,
  citedFiles,
  queryFor,
  readJournal,
  renderAgentic,
  runAgenticAblation,
  runKey,
  scoreAgentic,
  type AgenticRunRecord,
} from '../src/index.ts';

/**
 * The agentic ablation, tested without spending anything.
 *
 * The runner is about to spend real money — roughly $2 across a hundred-odd model calls — so
 * every part of it that can be proven offline is proven here first. The unit tests cover the
 * scoring, which is where a mistake would quietly corrupt a results table; the end-to-end
 * test drives the real runner against a real (tiny) git repository with the model transport
 * stubbed, so mining, the leakage-controlled worktree, the scan, the verifier, the journal,
 * resuming and the budget stop all execute for real. Only the HTTP call is fake.
 */

function evidence(file: string, verified: boolean): ContextEvidence {
  return {
    id: `ev-${file}-${String(verified)}`,
    file,
    line_start: 1,
    line_end: 5,
    symbol: null,
    claim: 'a claim',
    relevance: 'because',
    verified,
    failure_reason: verified ? null : 'file_not_found',
  };
}

function record(overrides: Partial<AgenticRunRecord> = {}): AgenticRunRecord {
  return {
    key: 'r|abc|grep',
    repo: 'r',
    sha: 'abc',
    subject: 'a feature',
    arm: 'grep',
    scorableFiles: ['src/a.ts', 'src/b.ts'],
    cited: ['src/a.ts'],
    totalClaims: 4,
    verifiedClaims: 3,
    toolCalls: 10,
    budgetExhausted: false,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 100,
    wallMs: 20_000,
    model: 'claude-haiku-5-5',
    error: null,
    ...overrides,
  };
}

describe('which files an agent is credited with', () => {
  it('counts only verified claims', () => {
    // A rejected citation is not evidence. Crediting it would reward an arm for a
    // hallucination that happened to name a real file.
    expect(citedFiles([evidence('src/a.ts', true), evidence('src/b.ts', false)])).toEqual([
      'src/a.ts',
    ]);
  });

  it('keeps the order the agent emitted them in, and lists each file once', () => {
    const rows = [
      evidence('src/b.ts', true),
      evidence('src/a.ts', true),
      evidence('src/b.ts', true),
      evidence('src/c.ts', true),
    ];

    expect(citedFiles(rows)).toEqual(['src/b.ts', 'src/a.ts', 'src/c.ts']);
  });

  it('normalises Windows separators so a match is not lost to a slash', () => {
    expect(citedFiles([evidence('src\\a.ts', true)])).toEqual(['src/a.ts']);
  });

  it('credits a file cited once verified even if it was cited unverified first', () => {
    expect(citedFiles([evidence('src/a.ts', false), evidence('src/a.ts', true)])).toEqual([
      'src/a.ts',
    ]);
  });

  it('gives nothing for no evidence', () => {
    expect(citedFiles([])).toEqual([]);
  });
});

describe('the query', () => {
  it('is the subject alone when there is no body', () => {
    expect(queryFor({ subject: 'Add retry handling', body: '' })).toBe('Add retry handling');
  });

  it('adds the body, as the deterministic arms do, so the two ablations ask the same thing', () => {
    expect(queryFor({ subject: 'Add retry', body: 'It backs off.' })).toBe(
      'Add retry\n\nIt backs off.',
    );
  });
});

describe('the journal', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentforge-agentic-journal-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads nothing from a file that does not exist yet', () => {
    expect(readJournal(join(dir, 'missing.jsonl'))).toEqual([]);
  });

  it('round-trips a record', () => {
    const path = join(dir, 'j.jsonl');
    writeFileSync(path, `${JSON.stringify(AgenticRunRecordSchema.parse(record()))}\n`);

    expect(readJournal(path)).toEqual([record()]);
  });

  it('refuses a malformed line instead of skipping it', () => {
    // These are paid results. A journal that quietly dropped a line it could not read would
    // let a resume re-run, and re-pay for, work that was already done.
    const path = join(dir, 'j.jsonl');
    writeFileSync(path, 'not json at all\n');

    expect(() => readJournal(path)).toThrow(/line 1 is not valid JSON/);
  });

  it('refuses a line that parses but breaks the schema', () => {
    const path = join(dir, 'j.jsonl');
    writeFileSync(path, `${JSON.stringify({ ...record(), costUsd: -1 })}\n`);

    expect(() => readJournal(path)).toThrow(/does not match the schema/);
  });

  it('keys a run by repository, commit and arm', () => {
    expect(runKey('execa', 'abc123', 'fts')).toBe('execa|abc123|fts');
  });
});

describe('scoring', () => {
  const ARMS = ['grep', 'fts'] as const;

  /** One commit, both arms, with a hand-computable outcome. */
  function pair(
    sha: string,
    grepCited: string[],
    ftsCited: string[],
    extra: Partial<AgenticRunRecord> = {},
  ) {
    return [
      record({ key: runKey('r', sha, 'grep'), sha, arm: 'grep', cited: grepCited, ...extra }),
      record({ key: runKey('r', sha, 'fts'), sha, arm: 'fts', cited: ftsCited, ...extra }),
    ];
  }

  it('computes recall against hand-worked values', () => {
    // Two scorable files. grep found one of two; fts found both.
    const result = scoreAgentic(
      pair('c1', ['src/a.ts', 'src/x.ts'], ['src/a.ts', 'src/b.ts']),
      ARMS,
      'claude-haiku-5-5',
    );

    const [grep, fts] = result.repos[0]?.arms ?? [];
    expect(grep?.recall['@10']?.mean).toBeCloseTo(0.5, 10);
    expect(fts?.recall['@10']?.mean).toBeCloseTo(1, 10);
  });

  it('scores only commits where every arm completed', () => {
    // fts failed on c2. If c2 counted for grep alone, grep would be compared against fts on
    // different ground — and an arm that fails often would look no worse than one that does
    // not, simply because its hard cases were dropped from its own column.
    const rows = [
      ...pair('c1', ['src/a.ts'], ['src/a.ts']),
      record({
        key: runKey('r', 'c2', 'grep'),
        sha: 'c2',
        arm: 'grep',
        cited: ['src/a.ts', 'src/b.ts'],
      }),
      record({ key: runKey('r', 'c2', 'fts'), sha: 'c2', arm: 'fts', cited: [], error: 'boom' }),
    ];

    const repo = scoreAgentic(rows, ARMS, 'm').repos[0];

    expect(repo?.commitsAttempted).toBe(2);
    expect(repo?.commitsComplete).toBe(1);
    expect(repo?.arms.every((arm) => arm.commits === 1)).toBe(true);
  });

  it('still counts the failure, against the arm that had it', () => {
    const rows = [
      ...pair('c1', ['src/a.ts'], ['src/a.ts']),
      record({ key: runKey('r', 'c2', 'fts'), sha: 'c2', arm: 'fts', error: 'boom' }),
    ];

    const arms = scoreAgentic(rows, ARMS, 'm').repos[0]?.arms ?? [];
    const fts = arms.find((arm) => arm.arm === 'fts');
    const grep = arms.find((arm) => arm.arm === 'grep');

    expect(fts?.errors).toBe(1);
    expect(grep?.errors).toBe(0);
  });

  it('reports no claims as a 0% unverified rate rather than dividing by zero', () => {
    const rows = pair('c1', [], [], { totalClaims: 0, verifiedClaims: 0 });

    const grep = scoreAgentic(rows, ARMS, 'm').repos[0]?.arms[0];

    expect(grep?.unverifiedClaimRate.mean).toBe(0);
    expect(Number.isNaN(grep?.unverifiedClaimRate.mean)).toBe(false);
  });

  it('measures the unverified-claim rate as the share that failed', () => {
    const rows = pair('c1', ['src/a.ts'], ['src/a.ts'], { totalClaims: 10, verifiedClaims: 7 });

    expect(scoreAgentic(rows, ARMS, 'm').repos[0]?.arms[0]?.unverifiedClaimRate.mean).toBeCloseTo(
      0.3,
      10,
    );
  });

  it('computes the cache hit rate over input tokens, as the cost summary does', () => {
    // 300 read of (100 fresh + 300 read + 100 written) = 0.6
    const rows = pair('c1', ['src/a.ts'], ['src/a.ts']);

    expect(scoreAgentic(rows, ARMS, 'm').repos[0]?.arms[0]?.cacheHitRate).toBeCloseTo(0.6, 10);
  });

  it('totals the spend across every run, failed ones included', () => {
    const rows = [
      ...pair('c1', ['src/a.ts'], ['src/a.ts'], { costUsd: 0.01 }),
      record({ key: runKey('r', 'c2', 'grep'), sha: 'c2', error: 'boom', costUsd: 0.02 }),
    ];

    // That money is gone whether or not the run produced a result, and a total that left
    // it out would understate what the experiment cost.
    expect(scoreAgentic(rows, ARMS, 'm').totals.costUsd).toBeCloseTo(0.04, 10);
  });

  it('renders every arm, and says what was and was not scored', () => {
    const md = renderAgentic(
      scoreAgentic(pair('c1', ['src/a.ts'], ['src/a.ts']), ARMS, 'claude-haiku-5-5'),
    );

    expect(md).toContain('# Agentic retrieval ablation');
    expect(md).toContain('`grep`');
    expect(md).toContain('`fts`');
    expect(md).toContain('commits where every arm completed');
    expect(md).toContain('recall@10 and @20');
  });
});

// ---------------------------------------------------------------------------------------------
// End to end, offline.

describe('the whole runner, with only the model transport faked', () => {
  let repo: string;
  let out: string;
  let stub: Stub;

  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=eval@test', '-c', 'user.name=eval', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });
  };

  /** One exploration turn, then the closing text, then the schema-constrained proposal. */
  function queueRun(file: string, line: number, symbol: string): void {
    stub.reply({ output: null, toolUses: [{ name: 'list_dir', input: { path: '.' } }] });
    stub.reply({ output: null, text: 'Looked around.' });
    stub.reply({
      output: {
        summary: 'The billing module owns finalisation.',
        claims: [
          {
            file,
            line_start: line,
            line_end: line,
            symbol,
            claim: 'This is where it happens.',
            relevance: 'The feature changes it.',
          },
        ],
        touched_modules: ['src'],
        open_questions: [],
      },
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'agentforge-agentic-repo-'));
    out = mkdtempSync(join(tmpdir(), 'agentforge-agentic-out-'));

    git('init', '-q');
    mkdirSync(join(repo, 'src'));
    writeFileSync(
      join(repo, 'src', 'billing.ts'),
      'export const rate = 1;\nexport function finalise(): number {\n  return rate;\n}\n',
    );
    writeFileSync(
      join(repo, 'src', 'client.ts'),
      'export function send(): string {\n  return "ok";\n}\n',
    );
    git('add', '-A');
    // Mined as a feature commit (long enough subject, two source files) but it only ADDED
    // files, so nothing was retrievable from its parent and it has to be skipped, not scored.
    git('commit', '-q', '-m', 'Create the initial billing and client modules');

    appendFileSync(join(repo, 'src', 'billing.ts'), 'export const retries = 3;\n');
    appendFileSync(join(repo, 'src', 'client.ts'), 'export const timeoutMs = 500;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'Add retry handling to the billing client');

    stub = installStub();
  });

  afterEach(() => {
    stub.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  const options = (overrides: object = {}) => ({
    repoPaths: [repo],
    commitsPerRepo: 5,
    arms: ['grep', 'fts'] as const,
    journalPath: join(out, 'journal.jsonl'),
    totalBudgetUsd: 10,
    runCapUsd: 1,
    concurrency: 1,
    model: 'claude-haiku-5-5',
    ...overrides,
  });

  it('mines, scans each arm, verifies, scores and journals — skipping a commit that only added files', async () => {
    queueRun('src/billing.ts', 2, 'finalise');
    queueRun('src/client.ts', 1, 'send');

    const outcome = await runAgenticAblation(options());

    // Two commits were mined; the first created files and was skipped, so only the feature
    // commit was run — once per arm.
    expect(outcome.records).toHaveLength(2);
    expect(outcome.budgetStopped).toBe(false);

    const [grep, fts] = outcome.records;
    expect(grep?.arm).toBe('grep');
    expect(grep?.subject).toBe('Add retry handling to the billing client');
    expect(grep?.error).toBeNull();
    // The cited file is real and was verified against the *parent* worktree.
    expect(grep?.cited).toEqual(['src/billing.ts']);
    expect(fts?.cited).toEqual(['src/client.ts']);
    expect(grep?.verifiedClaims).toBe(1);

    // Both source files existed in the parent, so both are in the denominator.
    expect([...(grep?.scorableFiles ?? [])].sort()).toEqual(['src/billing.ts', 'src/client.ts']);

    // And it was journalled.
    expect(readJournal(join(out, 'journal.jsonl'))).toHaveLength(2);
  });

  it('gives each arm its own tools, so the arms are different experiments', async () => {
    queueRun('src/billing.ts', 2, 'finalise');
    queueRun('src/billing.ts', 2, 'finalise');

    await runAgenticAblation(options());

    // The first call of each run is the loop: grep arm has no fts_search or repo_map.
    const grepTools = stub.calls[0]?.toolNames ?? [];
    expect(grepTools).toContain('grep');
    expect(grepTools).not.toContain('fts_search');
  });

  it('resumes from the journal and does not pay for the same run twice', async () => {
    queueRun('src/billing.ts', 2, 'finalise');
    queueRun('src/client.ts', 1, 'send');
    await runAgenticAblation(options());

    const callsAfterFirst = stub.calls.length;

    const again = await runAgenticAblation(options());

    // Nothing queued and nothing called: every run was already in the journal.
    expect(stub.calls.length).toBe(callsAfterFirst);
    expect(again.records).toHaveLength(2);
    expect(readFileSync(join(out, 'journal.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('stops scheduling when the budget would be passed, and says so', async () => {
    queueRun('src/billing.ts', 2, 'finalise');

    // The per-run cap alone already exceeds the total, so no run may start.
    const outcome = await runAgenticAblation(options({ totalBudgetUsd: 0.5, runCapUsd: 1 }));

    expect(outcome.budgetStopped).toBe(true);
    expect(outcome.records).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('records a failed run, with its cost, instead of throwing or dropping it', async () => {
    // Nothing queued: the stub has no reply for the first call, so the scan fails.
    const outcome = await runAgenticAblation(options({ arms: ['grep'] }));

    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.error).not.toBeNull();
    expect(outcome.records[0]?.cited).toEqual([]);
    // Recorded, so the arm that fails is visible in the table rather than flattered by it.
    expect(readJournal(join(out, 'journal.jsonl'))[0]?.error).not.toBeNull();
  });

  it('refuses a path that is not a git repository', async () => {
    await expect(runAgenticAblation(options({ repoPaths: [out] }))).rejects.toThrow(
      /not a git checkout/,
    );
  });
});
