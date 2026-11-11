import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentForgeError } from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import { createSpec, type Actor } from '@agentforge/orchestrator';
import {
  buildIndexEntries,
  buildRepoMap,
  createRepoRoot,
  escapeFtsQuery,
  indexRepository,
  indexSize,
  languageFor,
  renderRepoMap,
  resolveInside,
  scanRepository,
  search,
  searchIndex,
  toRepoRelative,
} from '../src/index.ts';
import { SAMPLE_REPO, makeFixture, makeOutsideDir, type Fixture } from './fixtures.ts';

/**
 * Stage 0: the deterministic scan.
 *
 * No model is involved anywhere in this file, which is the point — the inventory, the
 * repo map and the lexical index are all computable from the checkout, and doing them
 * first is what keeps the agentic loop cheap.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

let fx: Fixture;

beforeEach(() => {
  fx = makeFixture(SAMPLE_REPO);
});

afterEach(() => {
  fx.cleanup();
});

describe('path confinement', () => {
  it('resolves a path inside the repository', () => {
    const resolved = resolveInside(fx.root, 'src/orchestrator.ts');
    expect(toRepoRelative(fx.root, resolved)).toBe('src/orchestrator.ts');
  });

  it('refuses traversal out of the repository', () => {
    for (const path of ['../outside.txt', '../../etc/passwd', 'src/../../escape.txt']) {
      try {
        resolveInside(fx.root, path);
        throw new Error(`expected ${path} to be refused`);
      } catch (error) {
        expect((error as AgentForgeError).code, path).toBe('PATH_ESCAPES_ROOT');
      }
    }
  });

  it('refuses an absolute path', () => {
    const absolute = process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/passwd';
    expect(() => resolveInside(fx.root, absolute)).toThrow(/only repository-relative/);
  });

  it('refuses a NUL byte', () => {
    // A NUL truncates the path in some syscalls, which is a classic bypass.
    expect(() => resolveInside(fx.root, 'src/ok.ts\0.png')).toThrow(/NUL/);
  });

  it('refuses an empty path', () => {
    expect(() => resolveInside(fx.root, '')).toThrow(/must not be empty/);
  });

  it('refuses a symlink pointing outside the repository', () => {
    const outside = makeOutsideDir();
    try {
      if (!fx.link('src/escape.txt', join(outside.dir, 'secret.txt'))) {
        console.warn('symlinks unavailable on this platform; escape check skipped');
        return;
      }
      // The lexical path sits inside the root; only resolving it reveals the escape.
      expect(() => resolveInside(fx.root, 'src/escape.txt')).toThrow(/resolves outside/);
    } finally {
      outside.cleanup();
    }
  });

  it('rejects a root that does not exist', () => {
    expect(() => createRepoRoot(join(fx.dir, 'nowhere'))).toThrow(/does not exist/);
  });

  it('rejects a root that is a file', () => {
    expect(() => createRepoRoot(join(fx.dir, 'package.json'))).toThrow(/not a directory/);
  });

  it('allows a path that need not exist when asked', () => {
    const resolved = resolveInside(fx.root, 'src/not-yet.ts', { mustExist: false });
    expect(resolved).toContain('not-yet.ts');
    // But still refuses an escape even when existence is not required.
    expect(() => resolveInside(fx.root, '../escape.ts', { mustExist: false })).toThrow(
      /resolves outside/,
    );
  });
});

describe('file inventory', () => {
  it('lists source files and respects .gitignore', () => {
    const result = scanRepository(fx.root);
    const paths = result.files.map((f) => f.path);

    expect(paths).toContain('src/orchestrator.ts');
    expect(paths).toContain('src/billing/invoice.ts');
    expect(paths).toContain('src/util/helpers.py');

    // Ignored by .gitignore: indexing either would be wrong, and `secret.env` would be
    // a genuine leak into prompts.
    expect(paths).not.toContain('secret.env');
    expect(paths).not.toContain('dist/bundle.js');
  });

  it('reports sizes and languages', () => {
    const result = scanRepository(fx.root);
    const orchestrator = result.files.find((f) => f.path === 'src/orchestrator.ts');

    expect(orchestrator?.language).toBe('typescript');
    expect(orchestrator?.bytes).toBeGreaterThan(0);
    expect(result.files.find((f) => f.path === 'src/util/helpers.py')?.language).toBe('python');
    expect(result.files.find((f) => f.path === 'package.json')?.language).toBeNull();
  });

  it('returns paths in a stable order', () => {
    // Prompt caching needs byte-stable inputs, so an unordered inventory would destroy
    // the cache prefix between otherwise identical scans.
    const first = scanRepository(fx.root).files.map((f) => f.path);
    const second = scanRepository(fx.root).files.map((f) => f.path);
    expect(second).toEqual(first);
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('counts files per language', () => {
    const { stats } = scanRepository(fx.root);
    expect(stats.fileCount).toBeGreaterThan(3);
    expect(stats.byLanguage['typescript']).toBe(2);
    expect(stats.byLanguage['python']).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it('handles an empty repository', () => {
    const empty = makeFixture();
    try {
      const result = scanRepository(empty.root);
      expect(result.stats.fileCount).toBeGreaterThanOrEqual(0);
      expect(result.dependencies).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  it('uses git when the directory is a checkout, and honours .gitignore', () => {
    // The primary path. The plain fixture is not a checkout, so without this the git
    // branch would never be exercised and only the fallback would be tested.
    execFileSync('git', ['-C', fx.dir, 'init', '--quiet'], { stdio: 'ignore' });

    const result = scanRepository(fx.root);
    expect(result.stats.usedGit).toBe(true);

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('src/orchestrator.ts');
    expect(paths).not.toContain('secret.env');
    expect(paths).not.toContain('dist/bundle.js');
  });

  it('agrees between the git path and the fallback walk', () => {
    const withoutGit = scanRepository(fx.root);
    expect(withoutGit.stats.usedGit).toBe(false);

    execFileSync('git', ['-C', fx.dir, 'init', '--quiet'], { stdio: 'ignore' });
    const withGit = scanRepository(fx.root);
    expect(withGit.stats.usedGit).toBe(true);

    // Two implementations of the same question must give the same answer, or the
    // fallback would quietly change what the agent sees on a non-checkout.
    expect(withGit.files.map((f) => f.path)).toEqual(withoutGit.files.map((f) => f.path));
  });

  it('maps extensions to languages', () => {
    expect(languageFor('a/b.ts')).toBe('typescript');
    expect(languageFor('a/b.tsx')).toBe('tsx');
    expect(languageFor('a/b.py')).toBe('python');
    expect(languageFor('a/b.go')).toBe('go');
    expect(languageFor('a/b.java')).toBe('java');
    expect(languageFor('a/b.md')).toBeNull();
    expect(languageFor('Makefile')).toBeNull();
  });
});

describe('manifest parsing', () => {
  it('reads package.json dependencies and dev dependencies', () => {
    const { dependencies } = scanRepository(fx.root);

    const zod = dependencies.find((d) => d.name === 'zod');
    expect(zod).toMatchObject({ version: '^4.0.0', source: 'package.json', dev: false });
    expect(dependencies.find((d) => d.name === 'vitest')?.dev).toBe(true);
  });

  it('reads requirements.txt, skipping comments and options', () => {
    const { dependencies } = scanRepository(fx.root);
    const fromPip = dependencies.filter((d) => d.source === 'requirements.txt');

    expect(fromPip.map((d) => d.name).sort()).toEqual(['pydantic', 'requests']);
    expect(fromPip.find((d) => d.name === 'pydantic')?.version).toBe('==2.7.0');
  });

  it('skips a malformed manifest rather than aborting the scan', () => {
    fx.write('broken/package.json', '{ this is not json');

    // A broken manifest in one workspace must not stop the whole analysis.
    const result = scanRepository(fx.root);
    expect(result.dependencies.find((d) => d.name === 'zod')).toBeDefined();
  });

  it('reads go.mod require blocks', () => {
    fx.write(
      'go.mod',
      [
        'module example.com/app',
        'go 1.22',
        'require (',
        '\tgithub.com/stretchr/testify v1.9.0',
        '\tgolang.org/x/sync v0.7.0 // indirect',
        ')',
        'require github.com/spf13/cobra v1.8.0',
        '',
      ].join('\n'),
    );

    const fromGo = scanRepository(fx.root).dependencies.filter((d) => d.source === 'go.mod');
    expect(fromGo.map((d) => d.name).sort()).toEqual([
      'github.com/spf13/cobra',
      'github.com/stretchr/testify',
      'golang.org/x/sync',
    ]);
    expect(fromGo.find((d) => d.name === 'golang.org/x/sync')?.dev).toBe(true);
  });

  it('reads a pyproject dependencies array', () => {
    fx.write(
      'pyproject.toml',
      [
        '[project]',
        'name = "app"',
        'dependencies = [',
        '  "httpx>=0.27",',
        '  "rich",',
        ']',
        '',
      ].join('\n'),
    );

    const fromToml = scanRepository(fx.root).dependencies.filter(
      (d) => d.source === 'pyproject.toml',
    );
    expect(fromToml.map((d) => d.name).sort()).toEqual(['httpx', 'rich']);
    expect(fromToml.find((d) => d.name === 'httpx')?.version).toBe('>=0.27');
  });
});

describe('search', () => {
  it('finds an identifier with its line number', () => {
    const matches = search(fx.root, 'transitionSpec');

    expect(matches.length).toBeGreaterThan(0);
    const inOrchestrator = matches.find((m) => m.path === 'src/orchestrator.ts');
    expect(inOrchestrator?.line).toBeGreaterThan(0);
    expect(inOrchestrator?.text).toContain('transitionSpec');
  });

  it('restricts by glob', () => {
    const matches = search(fx.root, 'def ', { glob: '*.py' });
    expect(matches.every((m) => m.path.endsWith('.py'))).toBe(true);
  });

  it('returns nothing rather than failing when there are no matches', () => {
    // rg exits 1 for "no matches", which is an answer, not an error.
    expect(search(fx.root, 'thisDoesNotAppearAnywhereAtAll')).toEqual([]);
  });

  it('does not search ignored files', () => {
    const matches = search(fx.root, 'should-never-be-indexed');
    expect(matches).toEqual([]);
  });

  it('treats a pattern beginning with a dash as a pattern, not a flag', () => {
    // Passed via --regexp, so rg cannot read it as an option.
    expect(() => search(fx.root, '-e')).not.toThrow();
  });

  it('supports literal search for a string with regex characters', () => {
    fx.write('src/regexy.ts', 'const re = /a.*b/;\n');
    const matches = search(fx.root, 'a.*b', { literal: true });
    expect(matches.some((m) => m.path === 'src/regexy.ts')).toBe(true);
  });

  it('reports an invalid regex as an upstream failure', () => {
    try {
      search(fx.root, '(unclosed');
      throw new Error('expected the invalid pattern to be reported');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('UPSTREAM_FAILED');
    }
  });

  it('rejects an empty pattern', () => {
    expect(() => search(fx.root, '')).toThrow(/must not be empty/);
  });

  it('caps the number of matches', () => {
    const matches = search(fx.root, 'e', { maxMatches: 3 });
    expect(matches.length).toBeLessThanOrEqual(3);
  });
});

describe('repository map', () => {
  it('finds definitions across languages', async () => {
    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);

    const names = map.definitions.map((d) => d.name);
    expect(names).toContain('transitionSpec');
    expect(names).toContain('finaliseInvoice');
    expect(names).toContain('Orchestrator');
    // Python too, from the same pass.
    expect(names).toContain('normalise_gstin');
    expect(names).toContain('GstValidator');

    expect(map.stats.filesParsed).toBeGreaterThanOrEqual(3);
    expect(map.stats.definitionCount).toBe(map.definitions.length);
  });

  it('records accurate line ranges for a definition', async () => {
    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);

    const transitionSpec = map.definitions.find((d) => d.name === 'transitionSpec');
    expect(transitionSpec?.file).toBe('src/orchestrator.ts');
    // Line 2 in the fixture; the range must be usable as a citation.
    expect(transitionSpec?.lineStart).toBe(2);
    expect(transitionSpec?.lineEnd).toBeGreaterThanOrEqual(2);
  });

  it('ranks a cross-file symbol above a leaf', async () => {
    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);

    const ranked = map.entries.map((e) => e.name);
    const transitionSpec = ranked.indexOf('transitionSpec');
    const exportGst = ranked.indexOf('exportGstPayload');

    // transitionSpec is referenced from two files; exportGstPayload from none.
    expect(transitionSpec).toBeGreaterThanOrEqual(0);
    expect(transitionSpec).toBeLessThan(exportGst === -1 ? Number.MAX_SAFE_INTEGER : exportGst);
    expect(map.entries.find((e) => e.name === 'transitionSpec')?.referencedByFiles).toBeGreaterThan(
      0,
    );
  });

  it('is deterministic across runs', async () => {
    const { files } = scanRepository(fx.root);
    const first = await buildRepoMap(fx.root, files);
    const second = await buildRepoMap(fx.root, files);

    // Goes into the cached prompt prefix, so instability would cost real money.
    expect(second.entries.map((e) => `${e.file}:${e.name}`)).toEqual(
      first.entries.map((e) => `${e.file}:${e.name}`),
    );
  });

  it('skips a file that cannot be parsed without failing the scan', async () => {
    fx.write('src/truncated.ts', 'export function broken( {{{ unclosed');

    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);

    // tree-sitter is error-tolerant, so this may parse with errors rather than skip —
    // either way the rest of the repository must still be mapped.
    expect(map.definitions.some((d) => d.name === 'transitionSpec')).toBe(true);
  });

  it('biases the ranking towards focus terms', async () => {
    const { files } = scanRepository(fx.root);
    const plain = await buildRepoMap(fx.root, files);
    const focused = await buildRepoMap(fx.root, files, { focus: ['invoice', 'gst'] });

    const rankOf = (map: typeof plain, name: string): number =>
      map.entries.findIndex((e) => e.name === name);

    // A feature about invoices should surface invoice symbols sooner than a generic map.
    expect(rankOf(focused, 'finaliseInvoice')).toBeLessThanOrEqual(
      rankOf(plain, 'finaliseInvoice'),
    );
  });

  it('returns an empty map for a repository with no parseable source', async () => {
    const docs = makeFixture({ 'README.md': '# just docs\n' });
    try {
      const map = await buildRepoMap(docs.root, scanRepository(docs.root).files);
      expect(map.entries).toEqual([]);
      expect(renderRepoMap(map)).toBe('');
    } finally {
      docs.cleanup();
    }
  });

  it('renders within a token budget', async () => {
    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);

    const rendered = renderRepoMap(map, 200);
    expect(rendered).toContain('## Repository map');
    // Four characters per token with a 30% margin, as the cost estimator assumes.
    expect(rendered.length).toBeLessThanOrEqual(Math.floor((200 * 4) / 1.3) + 200);

    // A bigger budget includes more.
    expect(renderRepoMap(map, 4000).length).toBeGreaterThanOrEqual(rendered.length);
  });
});

describe('lexical index', () => {
  let dir: string;
  let db: Db;
  let specId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentforge-fts-'));
    db = createDb(join(dir, 'fts.db'));
    specId = createSpec(db, {
      title: 'Add GST export',
      description: 'Export invoices.',
      mode: 'brownfield',
      repo_path: fx.dir,
      actor: HUMAN,
    }).id;
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function index(): Promise<number> {
    const { files } = scanRepository(fx.root);
    const map = await buildRepoMap(fx.root, files);
    const entries = buildIndexEntries(fx.root, files, map.definitions);
    return indexRepository(db, specId, entries);
  }

  it('indexes files, symbols and comments', async () => {
    const count = await index();
    expect(count).toBeGreaterThan(0);
    expect(indexSize(db, specId)).toBe(count);
  });

  it('finds a symbol by exact name', async () => {
    await index();
    const hits = searchIndex(db, specId, 'transitionSpec');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path === 'src/orchestrator.ts')).toBe(true);
  });

  it('finds a file by a path segment', async () => {
    await index();
    // An agent searching for "invoice" should find the file even if no symbol matches.
    const hits = searchIndex(db, specId, 'invoice');
    expect(hits.some((h) => h.path === 'src/billing/invoice.ts')).toBe(true);
  });

  it('keeps underscores inside identifiers', async () => {
    await index();
    // The tokenizer must not split snake_case, or Python symbols become unfindable.
    const hits = searchIndex(db, specId, 'normalise_gstin');
    expect(hits.some((h) => h.symbol === 'normalise_gstin')).toBe(true);
  });

  it('finds a file by what its comment says it does', async () => {
    await index();
    const hits = searchIndex(db, specId, 'finalisation');
    expect(hits.some((h) => h.kind === 'comment')).toBe(true);
  });

  it('replaces a spec\u2019s rows on re-index', async () => {
    const first = await index();
    const second = await index();
    // A re-scan supersedes the previous one; rows must not accumulate.
    expect(second).toBe(first);
    expect(indexSize(db, specId)).toBe(first);
  });

  it('never indexes an ignored file', async () => {
    await index();
    const hits = searchIndex(db, specId, 'secret');
    expect(hits.some((h) => h.path === 'secret.env')).toBe(false);
  });

  it('scopes results to one spec', async () => {
    await index();
    const other = createSpec(db, {
      title: 'Unrelated',
      description: 'Another spec.',
      mode: 'brownfield',
      repo_path: fx.dir,
      actor: HUMAN,
    }).id;

    expect(searchIndex(db, other, 'transitionSpec')).toEqual([]);
  });

  it('escapes FTS5 operators in a query', async () => {
    await index();

    // Each of these means something in FTS5 syntax and would error or search for the
    // wrong thing if passed through raw.
    for (const query of [
      'transitionSpec OR x',
      'a NEAR b',
      'foo*',
      'col:value',
      '"quoted"',
      '-neg',
    ]) {
      expect(() => searchIndex(db, specId, query), query).not.toThrow();
    }
  });

  it('rejects a query with no searchable term', () => {
    for (const query of ['', '   ', '***', '()']) {
      expect(() => escapeFtsQuery(query), query).toThrow(/at least one searchable term/);
    }
  });

  it('builds an OR query so a candidate generator over-returns', () => {
    // Narrowing is the agent's job; returning nothing because one term was absent would
    // make the index useless as a first step.
    expect(escapeFtsQuery('invoice gst')).toBe('"invoice" OR "gst"');
  });
});
