import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentForgeError } from '@agentforge/contract';
import { checkoutParent, isGitRepository, isSourceFile, mineFeatureCommits } from '../src/index.ts';

/**
 * Ground-truth mining, against a real git repository built for the purpose.
 *
 * Two things are load-bearing and both are asserted here rather than assumed:
 *
 * - **The created/modified split.** Retrieval runs against the parent commit, so a file
 *   the feature *created* cannot be retrieved — it does not exist there. Putting one in
 *   the denominator charges every arm for an impossible task. The first version of this
 *   harness did exactly that and drove all four arms below 0.05, which is how the bug
 *   was found rather than reasoned about.
 * - **The worktree really is the parent.** If `checkoutParent` ever produced the commit
 *   itself, every arm would find the new files by name and the whole ablation would be
 *   measuring leakage.
 */

let repo: string;

function git(args: readonly string[], cwd = repo): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commit(
  subject: string,
  files: Readonly<Record<string, string>>,
  removed: readonly string[] = [],
): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(repo, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  for (const path of removed) {
    rmSync(join(repo, path), { force: true });
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', subject]);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'agentforge-mine-'));

  git(['init', '-q', '-b', 'main']);
  // Pinned locally so the suite does not depend on, or touch, the developer's git config.
  git(['config', 'user.email', 'eval@agentforge.local']);
  git(['config', 'user.name', 'Eval Fixture']);
  git(['config', 'commit.gpgsign', 'false']);

  commit('Add the initial invoice module and its helpers', {
    'src/invoice.ts': 'export function finalise() {\n  return 1;\n}\n',
    'src/helpers.ts': 'export function round(n: number) {\n  return n;\n}\n',
    'README.md': '# fixture\n',
  });

  // Modifies two existing files: fully scorable.
  commit('Validate the invoice total before finalising it', {
    'src/invoice.ts': 'export function finalise() {\n  return 2;\n}\n',
    'src/helpers.ts': 'export function round(n: number) {\n  return Math.round(n);\n}\n',
  });

  // Adds two new files and touches nothing else: nothing here is retrievable.
  commit('Add a gateway module for submitting payloads upstream', {
    'src/gateway.ts': 'export function submit() {\n  return true;\n}\n',
    'src/retry.ts': 'export function retry() {\n  return true;\n}\n',
  });

  // Mixed: one created, two modified.
  commit('Wire the gateway into invoice finalisation with retries', {
    'src/gateway.ts': 'export function submit() {\n  return false;\n}\n',
    'src/invoice.ts': 'export function finalise() {\n  return 3;\n}\n',
    'src/config.ts': 'export const url = "";\n',
  });

  // Noise that must be filtered out by subject.
  commit('chore: bump dependencies', { 'package.json': '{"name":"fixture"}\n' });
  commit('Merge branch feature into main', { 'src/helpers.ts': '// merged\n' });
  commit('fix typo', { 'README.md': '# fixture!\n' });
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('recognising a repository', () => {
  it('accepts a checkout and rejects a plain directory', () => {
    expect(isGitRepository(repo)).toBe(true);

    const plain = mkdtempSync(join(tmpdir(), 'agentforge-notrepo-'));
    try {
      expect(isGitRepository(plain)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('source-file filtering', () => {
  it('keeps source and drops everything else', () => {
    expect(isSourceFile('src/a.ts')).toBe(true);
    expect(isSourceFile('src/a.py')).toBe(true);
    expect(isSourceFile('README.md')).toBe(false);
    expect(isSourceFile('package.json')).toBe(false);
  });

  it('drops vendored code and lock files even when a commit touched them', () => {
    expect(isSourceFile('node_modules/x/index.js')).toBe(false);
    expect(isSourceFile('dist/bundle.js')).toBe(false);
    expect(isSourceFile('package-lock.json')).toBe(false);
    expect(isSourceFile('src/__snapshots__/a.ts.snap')).toBe(false);
  });
});

describe('mining', () => {
  it('finds the feature commits and skips the noise', () => {
    const mined = mineFeatureCommits(repo, { minGoldFiles: 1 });
    const subjects = mined.map((row) => row.subject);

    expect(subjects).toContain('Validate the invoice total before finalising it');
    expect(subjects).toContain('Wire the gateway into invoice finalisation with retries');

    // A chore, a merge and a subject too short to be a query.
    expect(subjects).not.toContain('chore: bump dependencies');
    expect(subjects.some((subject) => subject.startsWith('Merge'))).toBe(false);
    expect(subjects).not.toContain('fix typo');
  });

  it('separates files the commit created from files it modified', () => {
    const mined = mineFeatureCommits(repo, { minGoldFiles: 1 });

    const addOnly = mined.find((row) => row.subject.startsWith('Add a gateway module'));
    expect(addOnly).toBeDefined();
    expect([...(addOnly?.goldFiles ?? [])].sort()).toEqual(['src/gateway.ts', 'src/retry.ts']);
    // Both were created, so neither can be retrieved from the parent. This commit
    // contributes nothing scorable and the runner drops it.
    expect(addOnly?.modifiedFiles).toEqual([]);

    const mixed = mined.find((row) => row.subject.startsWith('Wire the gateway'));
    expect([...(mixed?.goldFiles ?? [])].sort()).toEqual([
      'src/config.ts',
      'src/gateway.ts',
      'src/invoice.ts',
    ]);
    // config.ts was created by this commit; gateway.ts and invoice.ts already existed.
    expect([...(mixed?.modifiedFiles ?? [])].sort()).toEqual(['src/gateway.ts', 'src/invoice.ts']);
  });

  it('respects the gold-file bounds', () => {
    // A sweeping change is not a feature: scoring recall against it would reward a
    // retriever for returning half the repository.
    const tight = mineFeatureCommits(repo, { minGoldFiles: 3, maxGoldFiles: 3 });
    for (const row of tight) {
      expect(row.goldFiles.length).toBe(3);
    }
  });

  it('honours the limit', () => {
    expect(mineFeatureCommits(repo, { limit: 1, minGoldFiles: 1 })).toHaveLength(1);
  });

  it('reports plainly when a repository yields nothing usable', () => {
    try {
      // No commit touches 40+ source files, so nothing survives the filter.
      mineFeatureCommits(repo, { minGoldFiles: 40 });
      throw new Error('expected mining to fail');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
      expect((error as Error).message).toContain('no feature commits found');
    }
  });
});

describe('the leakage control', () => {
  it('checks out the parent, where the feature does not exist yet', () => {
    const mined = mineFeatureCommits(repo, { minGoldFiles: 1 });
    const mixed = mined.find((row) => row.subject.startsWith('Wire the gateway'));
    expect(mixed).toBeDefined();

    const into = join(tmpdir(), `agentforge-wt-${String(Date.now())}`);
    const worktree = checkoutParent(repo, mixed?.sha ?? '', into);

    try {
      // config.ts is created by this commit, so it must be absent from the parent. If it
      // were present, the arms would find it by name and the ablation would be measuring
      // its own leakage.
      expect(existsSync(join(worktree.path, 'src/config.ts'))).toBe(false);
      // The files it modified do exist there — that is what makes them scorable.
      expect(existsSync(join(worktree.path, 'src/invoice.ts'))).toBe(true);
      expect(existsSync(join(worktree.path, 'src/gateway.ts'))).toBe(true);
    } finally {
      worktree.cleanup();
      rmSync(into, { recursive: true, force: true });
    }
  });

  it('reports a failure for a commit with no parent rather than silently scoring it', () => {
    const root = git(['rev-list', '--max-parents=0', 'HEAD']).trim();

    const into = join(tmpdir(), `agentforge-wt-root-${String(Date.now())}`);
    try {
      checkoutParent(repo, root, into);
      throw new Error('expected the root commit to have no parent');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
    } finally {
      rmSync(into, { recursive: true, force: true });
    }
  });
});
