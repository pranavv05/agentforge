import { createDb, type Db } from '@agentforge/db';
import {
  buildIndexEntries,
  buildRepoMap,
  createRepoRoot,
  indexRepository,
  scanRepository,
  search,
  searchIndex,
  type RepoMap,
  type ScannedFile,
} from '@agentforge/context-agent';
import { newId } from '@agentforge/orchestrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalisePath } from './metrics.ts';

/**
 * The deterministic retrieval ablation.
 *
 * This measures the *retrieval layer alone*, with no model anywhere: given a feature
 * request as text, each strategy ranks the repository's files, and recall@k is scored
 * against the files the real commit touched.
 *
 * Why it exists alongside the agentic ablation: it is free and it is deterministic. That
 * means it can run over every mined commit in every repository and report a mean with a
 * spread, which is what makes it evidence. The agentic arms measure the system people
 * actually use, but each run costs money and varies between runs, so they can only cover
 * a handful of commits — enough to show the agent benefits from better retrieval, not
 * enough to characterise the retrieval itself.
 *
 * The two answer different questions and the report needs both.
 */

export const DETERMINISTIC_ARMS = ['grep', 'repomap', 'fts', 'fts_repomap'] as const;

export type DeterministicArm = (typeof DETERMINISTIC_ARMS)[number];

export interface PreparedRepo {
  readonly root: ReturnType<typeof createRepoRoot>;
  readonly files: readonly ScannedFile[];
  readonly repoMap: RepoMap;
  readonly db: Db;
  readonly specId: string;
  readonly cleanup: () => void;
}

/**
 * Builds the indexes once per repository state.
 *
 * Every arm is scored against the same inventory, map and index, so a difference in
 * recall is a difference in *ranking strategy* and not an artefact of one arm having
 * seen a different snapshot.
 */
export async function prepareRepo(
  repoPath: string,
  focus: readonly string[],
): Promise<PreparedRepo> {
  const root = createRepoRoot(repoPath);
  const scan = scanRepository(root);
  const repoMap = await buildRepoMap(root, scan.files, { focus });

  // A throwaway database: FTS5 is a table, so the index needs somewhere to live, and an
  // eval run must not touch the development database.
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-eval-'));
  const db = createDb(join(dir, 'eval.db'));

  // A synthetic spec id, because the index is keyed by spec. No spec row is created:
  // nothing here transitions anything, and the index is dropped with the database.
  const specId = newId('spec');
  indexRepository(db, specId, buildIndexEntries(root, scan.files, repoMap.definitions));

  return {
    root,
    files: scan.files,
    repoMap,
    db,
    specId,
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Extracts query terms from a feature request.
 *
 * Deliberately crude — lower-cased words of four characters or more, minus a stop list.
 * A cleverer extractor would be a confound: the question is whether the repo map and the
 * lexical index beat grep, not whether a hand-tuned tokeniser can be built.
 */
export function queryTerms(request: string): readonly string[] {
  const STOP = new Set([
    'that',
    'this',
    'with',
    'from',
    'when',
    'where',
    'which',
    'what',
    'into',
    'then',
    'than',
    'have',
    'been',
    'were',
    'will',
    'shall',
    'should',
    'would',
    'must',
    'also',
    'they',
    'them',
    'their',
    'there',
    'about',
    'after',
    'before',
    'make',
    'made',
    'used',
    'using',
    'only',
    'more',
    'some',
    'such',
    'each',
    'does',
    'need',
    'needs',
    'test',
    'tests',
    'code',
    'file',
    'files',
    'support',
    'change',
    'changes',
    'update',
    'updates',
    'added',
    'adds',
  ]);

  return [
    ...new Set(
      request
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length >= 4 && !STOP.has(term)),
    ),
  ].slice(0, 12);
}

/** Splits an identifier-ish term into camelCase and snake_case parts, for matching. */
function expandTerm(term: string): readonly string[] {
  const parts = term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter((part) => part.length >= 4);
  return [...new Set([term, ...parts.map((part) => part.toLowerCase())])];
}

/** Ranks files by how many query terms grep finds in them, best first. */
function rankByGrep(prepared: PreparedRepo, terms: readonly string[], limit: number): string[] {
  const scores = new Map<string, number>();

  for (const term of terms) {
    let matches: readonly { path: string }[];
    try {
      matches = search(prepared.root, term, {
        literal: true,
        maxMatches: 400,
        files: prepared.files,
      });
    } catch {
      // A term that is not a usable pattern contributes nothing. This arm is the
      // baseline and must not be given error recovery the others do not have.
      continue;
    }

    // Counted per file per term, so a file mentioning several distinct query terms
    // outranks one mentioning a single term many times.
    const hitFiles = new Set(matches.map((match) => normalisePath(match.path)));
    for (const path of hitFiles) {
      scores.set(path, (scores.get(path) ?? 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

/** Ranks files by the personalised repo-map score of the symbols they define. */
function rankByRepoMap(prepared: PreparedRepo, terms: readonly string[], limit: number): string[] {
  const expanded = new Set(terms.flatMap(expandTerm));
  const scores = new Map<string, number>();

  for (const entry of prepared.repoMap.entries) {
    const name = entry.name.toLowerCase();
    const file = normalisePath(entry.file);
    const fileLower = file.toLowerCase();

    const matched = [...expanded].some((term) => name.includes(term) || fileLower.includes(term));

    // The ranking is already personalised by `focus`, so every entry carries some
    // signal; a term match multiplies it rather than replacing it.
    const score = entry.rank * (matched ? 10 : 1);
    scores.set(file, Math.max(scores.get(file) ?? 0, score));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

/** Ranks files by FTS5 relevance over symbol names, paths and doc comments. */
function rankByFts(prepared: PreparedRepo, terms: readonly string[], limit: number): string[] {
  const scores = new Map<string, number>();

  for (const term of terms) {
    for (const hit of searchIndex(prepared.db, prepared.specId, term, 50)) {
      const path = normalisePath(hit.path);
      scores.set(path, (scores.get(path) ?? 0) + hit.score);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

/**
 * Fuses the FTS and repo-map rankings with reciprocal rank fusion.
 *
 * RRF rather than adding the scores: FTS5 relevance and PageRank are on unrelated
 * scales, so summing them would silently let whichever has the larger numbers decide
 * every tie. Fusing on *rank* needs no calibration between the two.
 */
function rankByFused(prepared: PreparedRepo, terms: readonly string[], limit: number): string[] {
  // 60 is the constant from the original RRF paper; it damps the top ranks so one
  // list's first place cannot by itself win the fused ordering.
  const K = 60;
  const fused = new Map<string, number>();

  for (const ranking of [
    rankByFts(prepared, terms, limit * 3),
    rankByRepoMap(prepared, terms, limit * 3),
  ]) {
    for (const [index, path] of ranking.entries()) {
      fused.set(path, (fused.get(path) ?? 0) + 1 / (K + index + 1));
    }
  }

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

export function retrieve(
  prepared: PreparedRepo,
  arm: DeterministicArm,
  request: string,
  limit = 20,
): readonly string[] {
  const terms = queryTerms(request);
  if (terms.length === 0) return [];

  switch (arm) {
    case 'grep':
      return rankByGrep(prepared, terms, limit);
    case 'repomap':
      return rankByRepoMap(prepared, terms, limit);
    case 'fts':
      return rankByFts(prepared, terms, limit);
    case 'fts_repomap':
      return rankByFused(prepared, terms, limit);
  }
}
