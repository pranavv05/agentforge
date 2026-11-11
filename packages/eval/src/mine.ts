import { execFileSync } from 'node:child_process';
import { ValidationError } from '@agentforge/contract';

/**
 * Ground-truth mining from git history.
 *
 * The gold set for "which files does this feature touch?" is already written down: it is
 * the set of files the commit that implemented the feature actually changed. Mining it
 * costs nothing and nobody can accuse it of being hand-picked to flatter the retriever.
 *
 * Two things make this an honest experiment rather than a demonstration, and both are
 * enforced here rather than left to the runner:
 *
 * - **The query is the commit subject, not its diff.** The retriever is told what a
 *   person would have asked for, never what was done.
 * - **Retrieval runs against the parent commit.** If it ran against the commit itself,
 *   the answer would be sitting in the working tree — the new files would exist, named
 *   after the feature, and recall would be meaningless. `checkoutParent` below creates a
 *   worktree at `<commit>^` for exactly this reason.
 */

/** Commit subjects that describe no feature, so make no useful query. */
const UNINTERESTING = [
  /^merge\b/i,
  /^revert\b/i,
  /^bump\b/i,
  /^chore\b/i,
  /^(ci|build|deps?|dependabot)\b/i,
  /^v?\d+\.\d+\.\d+/,
  /^(wip|fixup|squash|amend)\b/i,
  /^(format|formatting|lint|prettier|whitespace|typo)\b/i,
  /^(release|publish|changelog)\b/i,
  /^(update|updated|updates)\s+(readme|docs?|changelog)/i,
  /^initial commit$/i,
];

/** Extensions we score on: source files a retriever could reasonably be asked to find. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.cs',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
]);

/** Paths excluded from the gold set even when a feature commit touched them. */
const EXCLUDED = [
  /(^|\/)(node_modules|vendor|dist|build|out|target|\.venv|venv)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock)$/,
  /\.(snap|lock|min\.js|map)$/,
];

export interface FeatureCommit {
  readonly sha: string;
  /** The commit subject, used verbatim as the retrieval query. */
  readonly subject: string;
  /** The commit body, if any — extra wording a requester might plausibly have given. */
  readonly body: string;
  /**
   * Source files this commit changed, repo-relative with forward slashes.
   *
   * This is every touched source file, created and modified alike. The *scorable* subset
   * is narrower — see `modifiedFiles`.
   */
  readonly goldFiles: readonly string[];
  /**
   * The gold files that already existed in the parent commit.
   *
   * This, not `goldFiles`, is what recall is scored against, and the distinction is the
   * difference between a meaningful experiment and a broken one. Retrieval runs against
   * the parent commit, so a file the feature *created* cannot be retrieved: it does not
   * exist yet. Scoring against it would charge every arm for an impossible task and
   * drive all of them towards zero, which is exactly what the first run of this harness
   * did — all four arms scored under 0.05 and the ranking was pure noise.
   *
   * Files the feature *modified* are the real question: "which existing code does this
   * change touch?" is what an agent needs answered before it writes anything.
   */
  readonly modifiedFiles: readonly string[];
  /** Total files changed, including those excluded from the gold set. */
  readonly filesChanged: number;
}

export interface MineOptions {
  /** Upper bound on commits returned. */
  readonly limit?: number;
  /**
   * Commits touching more source files than this are dropped.
   *
   * A sweeping refactor touching 200 files is not a feature, and scoring recall against
   * it would reward a retriever for returning half the repository.
   */
  readonly maxGoldFiles?: number;
  /** Commits touching fewer than this are dropped as too trivial to be a feature. */
  readonly minGoldFiles?: number;
  /** Only consider commits reachable from here. */
  readonly ref?: string;
}

function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Large histories on a cold cache are slow; this is generous but still bounded.
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // git's own stderr is the useful part of a failure, but it arrives loosely typed
    // on the thrown object, so it is narrowed to a string rather than stringified
    // blindly — an object would turn into "[object Object]" and say nothing.
    const raw =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? (error as { stderr?: unknown }).stderr
        : undefined;
    const stderr =
      typeof raw === 'string' ? raw : raw instanceof Buffer ? raw.toString('utf8') : '';
    throw new ValidationError(`git ${args.join(' ')} failed: ${stderr.trim() || 'unknown error'}`, {
      cwd,
      args,
    });
  }
}

export function isSourceFile(path: string): boolean {
  if (EXCLUDED.some((pattern) => pattern.test(path))) return false;

  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Mines feature commits, newest first.
 *
 * Uses a NUL-delimited format rather than parsing lines, because a commit subject can
 * contain anything — including the delimiter a line-based parse would pick.
 */
export function mineFeatureCommits(
  repoPath: string,
  options: MineOptions = {},
): readonly FeatureCommit[] {
  const limit = options.limit ?? 15;
  const maxGoldFiles = options.maxGoldFiles ?? 12;
  const minGoldFiles = options.minGoldFiles ?? 2;
  const ref = options.ref ?? 'HEAD';

  // `--no-merges` because a merge's file list is the union of both sides, which is not a
  // feature's footprint. Scanning well past `limit`: most commits are filtered out.
  const raw = git(repoPath, [
    'log',
    ref,
    '--no-merges',
    '--first-parent',
    `--max-count=${String(Math.max(limit * 30, 300))}`,
    // --name-status, not --name-only: the status letter is what separates a file the
    // commit added from one it modified, and only the latter can be retrieved from the
    // parent commit.
    '--name-status',
    '--format=%x00%H%x1f%s%x1f%b%x1f',
  ]);

  const commits: FeatureCommit[] = [];

  for (const chunk of raw.split('\0')) {
    if (chunk.trim().length === 0) continue;

    const parts = chunk.split('\u001f');
    const sha = parts[0]?.trim() ?? '';
    const subject = parts[1]?.trim() ?? '';
    const body = parts[2]?.trim() ?? '';
    const fileBlock = parts[3] ?? '';

    if (sha.length === 0 || subject.length === 0) continue;
    if (UNINTERESTING.some((pattern) => pattern.test(subject))) continue;
    // A subject too short to describe anything makes a useless query.
    if (subject.length < 15) continue;

    // Each line is "<status>\t<path>", or "<status>\t<old>\t<new>" for a rename.
    const touched: { status: string; path: string }[] = [];
    for (const line of fileBlock.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      const columns = trimmed.split('\t');
      const status = columns[0] ?? '';
      // For a rename or a copy the last column is the new path.
      const path = columns[columns.length - 1] ?? '';
      if (status.length === 0 || path.length === 0) continue;

      touched.push({ status, path });
    }

    const sourceFiles = touched.filter((row) => isSourceFile(row.path));
    const goldFiles = [...new Set(sourceFiles.map((row) => row.path))];
    if (goldFiles.length < minGoldFiles || goldFiles.length > maxGoldFiles) continue;

    // 'A' added, 'C' copied, 'R' renamed: under none of these does the path exist in the
    // parent commit, so none of them is retrievable. 'M' and 'D' both do exist there.
    const modifiedFiles = [
      ...new Set(sourceFiles.filter((row) => !/^[ACR]/.test(row.status)).map((row) => row.path)),
    ];

    commits.push({
      sha,
      subject,
      body,
      goldFiles,
      modifiedFiles,
      filesChanged: touched.length,
    });
    if (commits.length >= limit) break;
  }

  if (commits.length === 0) {
    throw new ValidationError(
      `no feature commits found in ${repoPath}: every candidate was a merge, a chore, or ` +
        `outside the ${String(minGoldFiles)}-${String(maxGoldFiles)} source-file range`,
      { repo_path: repoPath, ref },
    );
  }

  return commits;
}

export interface Worktree {
  readonly path: string;
  readonly cleanup: () => void;
}

/**
 * Checks out a commit's parent into a throwaway worktree.
 *
 * This is the step that makes the measurement mean anything. Retrieval must run against
 * the code as it was *before* the feature existed; run against the commit itself, a
 * retriever would find the new files by name and score near-perfectly while having
 * demonstrated nothing.
 */
export function checkoutParent(repoPath: string, sha: string, into: string): Worktree {
  // `--detach` so the worktree holds no branch, and `-f` because the same path may be
  // re-used across arms within one run.
  git(repoPath, ['worktree', 'add', '--detach', '-f', into, `${sha}^`]);

  return {
    path: into,
    cleanup: () => {
      try {
        git(repoPath, ['worktree', 'remove', '--force', into]);
      } catch {
        // Already gone, or the directory was removed by hand. Nothing to recover: the
        // worktree list is pruned below, and failing cleanup must not fail a run that
        // has already produced its measurements.
      }
      try {
        git(repoPath, ['worktree', 'prune']);
      } catch {
        // Same reasoning.
      }
    },
  };
}

/** True when the path is a git checkout we can mine. */
export function isGitRepository(repoPath: string): boolean {
  try {
    return git(repoPath, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}
