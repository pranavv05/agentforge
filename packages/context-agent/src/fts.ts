import { ValidationError } from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import { readFileSync } from 'node:fs';
import { resolveInside, type RepoRoot } from './paths.ts';
import type { SymbolDefinition } from './repomap.ts';
import type { ScannedFile } from './scan.ts';

/**
 * The lexical index.
 *
 * SQLite's FTS5, which ships inside the database we already run, so there is no index
 * service and no embedding cost. It plays to its strengths deliberately: lexical search
 * is strong on identifiers, file names and error strings, and weak on paraphrase. The
 * agent gets it as a *candidate generator* — a cheap way to find where a name lives —
 * and reads the file to confirm.
 *
 * The tokenizer keeps `_` and `$` inside identifiers, because splitting `snake_case` or
 * `$scope` into pieces is exactly wrong for code.
 */

export interface IndexEntry {
  readonly path: string;
  readonly symbol: string;
  readonly kind: string;
  readonly snippet: string;
}

/** How much of a line to keep. Long enough to recognise, short enough not to bloat. */
const MAX_SNIPPET_CHARS = 240;

/** Comment prefixes worth indexing; a comment often names the thing better than the code. */
const COMMENT_PREFIXES = ['//', '#', '*', '--'] as const;

/**
 * Builds index entries for a repository.
 *
 * Three kinds of row: one per file path, one per symbol definition, and one per
 * substantive comment line. The path rows matter more than they look — an agent
 * searching for "invoice" should find `src/billing/invoice.ts` even if no symbol inside
 * it is called that.
 */
export function buildIndexEntries(
  root: RepoRoot,
  files: readonly ScannedFile[],
  definitions: readonly SymbolDefinition[],
): readonly IndexEntry[] {
  const entries: IndexEntry[] = [];

  for (const file of files) {
    entries.push({
      path: file.path,
      // Path segments as the searchable token set, so a directory name is findable.
      symbol: file.path
        .split('/')
        .join(' ')
        .replace(/\.[a-z]+$/i, ''),
      kind: 'file',
      snippet: file.path,
    });
  }

  for (const definition of definitions) {
    entries.push({
      path: definition.file,
      symbol: definition.name,
      kind: definition.kind,
      snippet: `${definition.kind} ${definition.name} at ${definition.file}:${String(
        definition.lineStart,
      )}`,
    });
  }

  // Comments are indexed per file rather than per line to keep the index small: a few
  // representative lines are enough to make a file findable by what it says it does.
  for (const file of files) {
    if (file.language === null) continue;

    let contents: string;
    try {
      contents = readFileSync(resolveInside(root, file.path), 'utf8');
    } catch {
      continue;
    }

    const comments: string[] = [];
    for (const raw of contents.split('\n')) {
      const line = raw.trim();
      if (line.length < 12) continue;
      if (!COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;

      const text = line.replace(/^(\/\/+|#+|\*+|--+)\s*/, '').trim();
      // Skip decoration lines and licence boilerplate noise.
      if (text.length < 12 || /^[-=*_\s]+$/.test(text)) continue;

      comments.push(text);
      if (comments.length >= 20) break;
    }

    if (comments.length > 0) {
      entries.push({
        path: file.path,
        symbol: '',
        kind: 'comment',
        snippet: comments.join(' ').slice(0, 4_000),
      });
    }
  }

  return entries;
}

/** Replaces a spec's rows in the index. A re-scan supersedes the previous one. */
export function indexRepository(db: Db, specId: string, entries: readonly IndexEntry[]): number {
  const sqlite = db.$client;

  const replace = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM code_index WHERE spec_id = ?').run(specId);

    const insert = sqlite.prepare(
      'INSERT INTO code_index (spec_id, path, symbol, kind, snippet) VALUES (?, ?, ?, ?, ?)',
    );
    for (const entry of entries) {
      insert.run(
        specId,
        entry.path,
        entry.symbol,
        entry.kind,
        entry.snippet.slice(0, MAX_SNIPPET_CHARS * 20),
      );
    }
    return entries.length;
  });

  return replace();
}

export interface FtsHit {
  readonly path: string;
  readonly symbol: string;
  readonly kind: string;
  readonly snippet: string;
  /** FTS5 relevance; more negative is a better match, so it is negated here. */
  readonly score: number;
}

/**
 * Escapes a user query for FTS5.
 *
 * FTS5 has its own query syntax — `NEAR`, `*`, `:`, `-`, `"` and parentheses all mean
 * something. A model-supplied query containing any of them would either error or search
 * for something other than what was asked. Each term is therefore quoted as a literal
 * phrase, which is both safe and what the caller means by a search term.
 */
export function escapeFtsQuery(query: string): string {
  const terms = query
    .split(/[^A-Za-z0-9_$]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (terms.length === 0) {
    throw new ValidationError('a search query must contain at least one searchable term', {
      query,
    });
  }

  // OR rather than AND: a candidate generator should over-return and let the agent
  // narrow, not silently return nothing because one term was absent.
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}

/** Searches the index for a spec. */
export function searchIndex(db: Db, specId: string, query: string, limit = 25): readonly FtsHit[] {
  const escaped = escapeFtsQuery(query);

  interface Row {
    readonly path: string;
    readonly symbol: string;
    readonly kind: string;
    readonly snippet: string;
    readonly score: number;
  }

  const rows = db.$client
    .prepare<[string, string, number], Row>(
      `SELECT path, symbol, kind, snippet, bm25(code_index) AS score
         FROM code_index
        WHERE spec_id = ? AND code_index MATCH ?
        ORDER BY score
        LIMIT ?`,
    )
    .all(specId, escaped, limit);

  return rows.map((row) => ({
    path: row.path,
    symbol: row.symbol,
    kind: row.kind,
    snippet: row.snippet.slice(0, MAX_SNIPPET_CHARS),
    // Negated so a larger number is a better match, which is what a reader expects.
    score: -row.score,
  }));
}

/** How many rows a spec has indexed. Used by the scan report and the tests. */
export function indexSize(db: Db, specId: string): number {
  const row = db.$client
    .prepare<[string], { count: number }>(
      'SELECT count(*) AS count FROM code_index WHERE spec_id = ?',
    )
    .get(specId);
  return row?.count ?? 0;
}
