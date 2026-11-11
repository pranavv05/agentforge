import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '@agentforge/db';
import { createSpec, type Actor } from '@agentforge/orchestrator';
import {
  CONTEXT_TOOLS,
  buildIndexEntries,
  buildRepoMap,
  executeContextTool,
  indexRepository,
  scanRepository,
  type RepoMap,
  type ScannedFile,
  type ToolContext,
} from '../src/index.ts';
import { SAMPLE_REPO, makeFixture, makeOutsideDir, type Fixture } from './fixtures.ts';

/**
 * The agent's search tools.
 *
 * Every argument here comes from a model reading an untrusted repository, so this file
 * is written adversarially. Two properties matter and neither is a nicety:
 *
 * - **A bad argument is answered, not thrown.** In a tool loop, a thrown error ends the
 *   run and throws away everything found so far; a returned message lets the model fix
 *   its call. So almost every test below asserts on returned *text*.
 * - **Confinement holds regardless of what is asked for.** A path that leaves the
 *   repository is refused whether it does so by traversal, by absolute path, or through
 *   a symlink.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

let fx: Fixture;
let db: Db;
let dbDir: string;
let ctx: ToolContext;
let specId: string;
let files: readonly ScannedFile[];
let repoMap: RepoMap;

// Built once for the file, not per test. Parsing the repository with tree-sitter and
// indexing it is the expensive part of the setup, and every test here is read-only, so
// doing it 25 times only made the suite slow enough to time out.
beforeAll(async () => {
  fx = makeFixture(SAMPLE_REPO);
  dbDir = mkdtempSync(join(tmpdir(), 'agentforge-tools-'));
  db = createDb(join(dbDir, 'test.db'));

  const spec = createSpec(db, {
    title: 'GST invoice export',
    description: 'Export a finalised invoice as a GST e-invoice payload.',
    mode: 'brownfield',
    repo_path: fx.dir,
    actor: HUMAN,
  });
  specId = spec.id;

  const scan = scanRepository(fx.root);
  files = scan.files;
  repoMap = await buildRepoMap(fx.root, files);
  indexRepository(db, specId, buildIndexEntries(fx.root, files, repoMap.definitions));

  ctx = { root: fx.root, db, specId, files, repoMap };
});

afterAll(() => {
  db.$client.close();
  rmSync(dbDir, { recursive: true, force: true });
  fx.cleanup();
});

const run = (name: string, input: unknown): string => executeContextTool(ctx, name, input);

describe('the tool surface', () => {
  it('describes every tool with a JSON schema the API will accept', () => {
    expect(CONTEXT_TOOLS.length).toBeGreaterThan(0);

    for (const tool of CONTEXT_TOOLS) {
      expect(tool.name, 'name').toMatch(/^[a-z_]+$/);
      // The description is prompt text the model acts on, so an empty one is a bug.
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect(tool.inputSchema['type'], tool.name).toBe('object');
    }
  });

  it('refuses a tool name it does not implement', () => {
    // Our bug, not a model mistake: the switch and the tool list have diverged. This is
    // the one case that throws rather than answering.
    expect(() => run('rm_rf', {})).toThrow(/unknown context tool/);
  });
});

describe('read_file confinement', () => {
  it('reads an inclusive range with line numbers', () => {
    const out = run('read_file', { path: 'src/orchestrator.ts', line_start: 1, line_end: 3 });
    expect(out).toContain('src/orchestrator.ts lines 1-3');
    expect(out).toMatch(/^1\t/m);
  });

  it('refuses a traversal escape', () => {
    const out = run('read_file', { path: '../../../etc/passwd', line_start: 1, line_end: 1 });
    expect(out).toContain('Cannot read');
    // Echoing the *requested* path back is useful — the model needs to know which call
    // was refused. What a refusal must not disclose is where the repository actually
    // lives on disk, which is information the model was never given.
    expect(out).not.toContain(fx.dir);
  });

  it('refuses an absolute path outside the repository', () => {
    const outside = makeOutsideDir();
    try {
      const out = run('read_file', {
        path: join(outside.dir, 'secret.env').replace(/\\/g, '/'),
        line_start: 1,
        line_end: 1,
      });
      expect(out).toContain('Cannot read');
    } finally {
      outside.cleanup();
    }
  });

  it('refuses a symlink pointing out of the repository', () => {
    const outside = makeOutsideDir();
    try {
      const linked = fx.link('escape.ts', join(outside.dir, 'secret.env'));
      if (!linked) return; // Unprivileged Windows cannot create the link; nothing to assert.

      const out = run('read_file', { path: 'escape.ts', line_start: 1, line_end: 1 });
      expect(out).toContain('Cannot read');
    } finally {
      outside.cleanup();
    }
  });

  it('reports a missing file rather than throwing', () => {
    const out = run('read_file', { path: 'src/nope.ts', line_start: 1, line_end: 5 });
    expect(out).toContain('does not exist');
  });

  it('points at list_dir when handed a directory', () => {
    const out = run('read_file', { path: 'src', line_start: 1, line_end: 5 });
    expect(out).toContain('list_dir');
  });

  it('says so when the range starts past the end of the file', () => {
    const out = run('read_file', {
      path: 'src/orchestrator.ts',
      line_start: 9_000,
      line_end: 9_001,
    });
    expect(out).toMatch(/past the end/);
  });

  it('rejects an inverted range', () => {
    const out = run('read_file', { path: 'src/orchestrator.ts', line_start: 10, line_end: 2 });
    expect(out).toContain('before line_start');
  });

  it('caps a read so one call cannot swallow the prompt budget', () => {
    const big = Array.from({ length: 2_000 }, (_, i) => `const x${String(i)} = ${String(i)};`);
    fx.write('src/big.ts', big.join('\n'));

    const out = run('read_file', { path: 'src/big.ts', line_start: 1, line_end: 2_000 });
    expect(out).toContain('reads are capped');
    // 400 lines of content, not 2000.
    expect(out.split('\n').filter((line) => /^\d+\t/.test(line))).toHaveLength(400);
  });

  it('explains a malformed argument instead of failing the run', () => {
    const out = run('read_file', { path: 'src/orchestrator.ts', line_start: 0, line_end: 5 });
    expect(out).toContain('Invalid arguments for read_file');
    expect(out).toContain('call it again');
  });
});

describe('grep', () => {
  it('finds a literal identifier with file and line', () => {
    const out = run('grep', { pattern: 'transitionSpec' });
    expect(out).toMatch(/src\/orchestrator\.ts:\d+:/);
  });

  it('restricts to a glob', () => {
    const out = run('grep', { pattern: 'export', glob: '*.json' });
    expect(out).not.toContain('.ts:');
  });

  it('hands back the engine error for an invalid regular expression', () => {
    // A model writing a bad regex is routine. It needs the message to fix it, not a
    // crashed run.
    const out = run('grep', { pattern: '([unclosed' });
    expect(out).toContain('grep failed');
  });

  it('says plainly when there are no matches', () => {
    const out = run('grep', { pattern: 'zzzNotInThisRepoZzz' });
    expect(out).toContain('No matches');
  });
});

describe('fts_search', () => {
  it('finds an indexed symbol', () => {
    const out = run('fts_search', { query: 'finaliseInvoice' });
    expect(out).toContain('src/billing/invoice.ts');
  });

  it('suggests a fallback when the index has nothing', () => {
    const out = run('fts_search', { query: 'zzzNotIndexedZzz' });
    expect(out).toContain('grep');
  });

  it('treats FTS5 operators as literal text rather than erroring', () => {
    // `NEAR`, `*` and quotes all mean something to FTS5. A model-supplied query
    // containing them must not become a syntax error.
    const out = run('fts_search', { query: 'invoice NEAR* "x' });
    expect(out).not.toContain('Invalid arguments');
  });
});

describe('list_dir', () => {
  it('lists the root for an empty path and marks directories', () => {
    const out = run('list_dir', { path: '' });
    expect(out).toContain('src/');
    expect(out).toContain('package.json');
  });

  it('refuses to list outside the repository', () => {
    const out = run('list_dir', { path: '../..' });
    expect(out).toContain('Cannot list');
  });

  it('reports a missing directory rather than throwing', () => {
    const out = run('list_dir', { path: 'does/not/exist' });
    expect(out).toContain('Cannot list');
  });
});

describe('repo_map', () => {
  it('renders the ranked map with no focus terms', () => {
    const out = run('repo_map', {});
    expect(out.length).toBeGreaterThan(0);
  });

  it('promotes entries matching the focus terms', () => {
    // The point of personalising the ranking: the same repository should give a
    // different map for a different feature.
    const generic = run('repo_map', {});
    const focused = run('repo_map', { focus: ['invoice'] });
    expect(focused).not.toBe(generic);
    expect(focused).toContain('invoice');
  });

  it('rejects more focus terms than the schema allows', () => {
    const out = run('repo_map', { focus: Array.from({ length: 50 }, (_, i) => `t${String(i)}`) });
    expect(out).toContain('Invalid arguments for repo_map');
  });
});
