import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ValidationError } from '@agentforge/contract';
import { logger } from '@agentforge/orchestrator';
import { checkoutParent, isGitRepository, mineFeatureCommits, type FeatureCommit } from './mine.ts';
import {
  formatDistribution,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  normalisePath,
  summarise,
  type Distribution,
} from './metrics.ts';
import { DETERMINISTIC_ARMS, prepareRepo, retrieve, type DeterministicArm } from './retrieval.ts';

/**
 * The ablation runner.
 *
 * For each mined feature commit it checks out the commit's **parent**, builds the
 * indexes once, and asks every arm the same question: given this feature request, which
 * files would you put in front of the agent? Recall is scored against the files the
 * commit actually changed.
 *
 * The result is written as JSON so the table can be regenerated without re-running, and
 * as markdown for the report.
 */

/** The k values reported. 10 is the headline: it is roughly what an agent will read. */
export const K_VALUES = [1, 5, 10, 20] as const;

export interface CommitResult {
  readonly sha: string;
  readonly subject: string;
  /** Every source file the commit touched, for context. */
  readonly goldFiles: readonly string[];
  /**
   * The files scored against: those that existed in the parent commit and were still
   * present when the worktree was checked out.
   */
  readonly scorableFiles: readonly string[];
  /** Per arm: the ranked paths it returned. Kept so scores can be recomputed. */
  readonly retrieved: Readonly<Record<string, readonly string[]>>;
}

export interface ArmSummary {
  readonly arm: string;
  readonly recall: Readonly<Record<string, Distribution>>;
  readonly precisionAt10: Distribution;
  readonly mrr: Distribution;
}

export interface RepoResult {
  readonly repo: string;
  readonly commitsEvaluated: number;
  readonly commitsSkipped: number;
  readonly goldFilesPerCommit: Distribution;
  /** The real denominator: pre-existing files the commit modified. */
  readonly scorableFilesPerCommit: Distribution;
  readonly commits: readonly CommitResult[];
  readonly arms: readonly ArmSummary[];
}

export interface EvalResult {
  /** What was measured, so a results table cannot be read as something it is not. */
  readonly experiment: {
    readonly description: string;
    readonly arms: readonly string[];
    readonly k_values: readonly number[];
    readonly leakage_control: string;
    /** How the gold set is restricted, and why. */
    readonly scoring: string;
  };
  readonly repos: readonly RepoResult[];
}

export interface RunOptions {
  readonly repoPaths: readonly string[];
  readonly commitsPerRepo?: number;
  readonly arms?: readonly DeterministicArm[];
  /** How many paths each arm may return. The largest k must not exceed this. */
  readonly limit?: number;
}

function scoreArm(arm: string, commits: readonly CommitResult[]): ArmSummary {
  const recall: Record<string, Distribution> = {};

  for (const k of K_VALUES) {
    recall[`@${String(k)}`] = summarise(
      commits.map((commit) => recallAtK(commit.retrieved[arm] ?? [], commit.scorableFiles, k)),
    );
  }

  return {
    arm,
    recall,
    precisionAt10: summarise(
      commits.map((commit) => precisionAtK(commit.retrieved[arm] ?? [], commit.scorableFiles, 10)),
    ),
    mrr: summarise(
      commits.map((commit) => reciprocalRank(commit.retrieved[arm] ?? [], commit.scorableFiles)),
    ),
  };
}

export async function runAblation(options: RunOptions): Promise<EvalResult> {
  const arms = options.arms ?? DETERMINISTIC_ARMS;
  const commitsPerRepo = options.commitsPerRepo ?? 12;
  const limit = options.limit ?? 20;

  const maxK = Math.max(...K_VALUES);
  if (limit < maxK) {
    throw new ValidationError(
      `limit (${String(limit)}) is below the largest k (${String(maxK)}), so recall@${String(maxK)} ` +
        'would be capped by the retrieval depth rather than measuring the ranking',
      { limit, max_k: maxK },
    );
  }

  const repos: RepoResult[] = [];

  for (const repoPath of options.repoPaths) {
    if (!isGitRepository(repoPath)) {
      throw new ValidationError(
        `${repoPath} is not a git checkout, so no ground truth can be mined from it`,
        { repo_path: repoPath },
      );
    }

    const mined = mineFeatureCommits(repoPath, { limit: commitsPerRepo });
    logger.info(
      { repo: repoPath, commits: mined.length },
      'mined feature commits from git history',
    );

    const results: CommitResult[] = [];
    let skipped = 0;

    for (const commit of mined) {
      const result = await evaluateCommit(repoPath, commit, arms, limit);
      if (result === null) skipped += 1;
      else results.push(result);
    }

    if (results.length === 0) {
      throw new ValidationError(
        `every mined commit in ${repoPath} failed to evaluate; nothing can be reported`,
        { repo_path: repoPath, skipped },
      );
    }

    repos.push({
      repo: basename(repoPath),
      commitsEvaluated: results.length,
      commitsSkipped: skipped,
      goldFilesPerCommit: summarise(results.map((row) => row.goldFiles.length)),
      scorableFilesPerCommit: summarise(results.map((row) => row.scorableFiles.length)),
      commits: results,
      arms: arms.map((arm) => scoreArm(arm, results)),
    });
  }

  return {
    experiment: {
      description:
        'Deterministic retrieval ablation. For each feature commit mined from git ' +
        'history, every arm ranks the repository files given the commit subject as the ' +
        'query. Recall is scored against the source files that commit changed. No model ' +
        'is involved in any arm, so the figures are exactly reproducible and cost nothing.',
      arms: [...arms],
      k_values: [...K_VALUES],
      leakage_control:
        "Retrieval runs against the commit's parent, in a detached worktree, so the " +
        'files the feature added do not exist yet. The query is the commit subject only; ' +
        'the diff is never shown to any arm.',
      scoring:
        'Recall is scored only against files that existed in the parent commit and were ' +
        'modified by the feature — not against files the feature created, which cannot ' +
        'be retrieved from a tree where they do not exist. Commits that only added files ' +
        'are excluded entirely. Scoring against created files was the first version of ' +
        'this harness and it drove every arm below 0.05, measuring nothing.',
    },
    repos,
  };
}

/** Returns null when this commit could not be evaluated, rather than failing the run. */
async function evaluateCommit(
  repoPath: string,
  commit: FeatureCommit,
  arms: readonly DeterministicArm[],
  limit: number,
): Promise<CommitResult | null> {
  const worktreeDir = mkdtempSync(join(tmpdir(), 'agentforge-eval-wt-'));
  // `mkdtemp` created it, but `git worktree add` wants to create the path itself.
  rmSync(worktreeDir, { recursive: true, force: true });

  let worktree;
  try {
    worktree = checkoutParent(repoPath, commit.sha, worktreeDir);
  } catch (error) {
    // The usual cause is a root commit, which has no parent. Skipped and counted, not
    // fatal: one unusable commit must not discard a whole repository's results.
    logger.warn(
      { sha: commit.sha, error: error instanceof Error ? error.message : String(error) },
      'could not check out the parent commit; skipping',
    );
    return null;
  }

  try {
    const query = commit.body.length > 0 ? `${commit.subject}\n\n${commit.body}` : commit.subject;

    const prepared = await prepareRepo(
      worktree.path,
      query
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length >= 4)
        .slice(0, 10),
    );

    try {
      const retrieved: Record<string, readonly string[]> = {};
      for (const arm of arms) {
        retrieved[arm] = retrieve(prepared, arm, query, limit);
      }

      // Scored against the files that existed in the parent *and* are still there in the
      // checked-out worktree. The existence check is belt and braces over the status
      // letters: a file modified by this commit but deleted by an earlier one on a
      // different path, or any history rewriting, would otherwise put an unreachable
      // path into the denominator.
      const present = new Set(prepared.files.map((file) => normalisePath(file.path)));
      const scorableFiles = commit.modifiedFiles
        .map(normalisePath)
        .filter((path) => present.has(path));

      // A commit that only *added* files has nothing an arm could have retrieved, so
      // it is dropped rather than scored as a zero. Keeping it would punish every arm
      // equally for an impossible task and drag all the means towards nothing, which is
      // precisely how the first version of this harness produced four indistinguishable
      // near-zero rows.
      if (scorableFiles.length === 0) {
        logger.info(
          { sha: commit.sha, gold_files: commit.goldFiles.length },
          'commit only created files, so nothing was retrievable; skipping',
        );
        return null;
      }

      return {
        sha: commit.sha,
        subject: commit.subject,
        goldFiles: commit.goldFiles,
        scorableFiles,
        retrieved,
      };
    } finally {
      prepared.cleanup();
    }
  } catch (error) {
    logger.warn(
      { sha: commit.sha, error: error instanceof Error ? error.message : String(error) },
      'commit evaluation failed; skipping',
    );
    return null;
  } finally {
    worktree.cleanup();
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

/** Renders the results as the markdown table the report carries. */
export function renderResults(result: EvalResult): string {
  const lines: string[] = [
    '# Retrieval ablation',
    '',
    result.experiment.description,
    '',
    `**Leakage control.** ${result.experiment.leakage_control}`,
    '',
    `**Scoring.** ${result.experiment.scoring}`,
    '',
  ];

  for (const repo of result.repos) {
    lines.push(
      `## ${repo.repo}`,
      '',
      `- feature commits evaluated: ${String(repo.commitsEvaluated)}` +
        (repo.commitsSkipped > 0 ? ` (${String(repo.commitsSkipped)} skipped)` : ''),
      `- source files touched per commit: ${formatDistribution(repo.goldFilesPerCommit, 1)}`,
      '- of those, pre-existing and therefore scorable: ' +
        formatDistribution(repo.scorableFilesPerCommit, 1),
      '',
      '| arm | recall@1 | recall@5 | recall@10 | recall@20 | precision@10 | MRR |',
      '|---|---|---|---|---|---|---|',
    );

    for (const arm of repo.arms) {
      const cell = (key: string): string => {
        const dist = arm.recall[key];
        return dist === undefined ? 'n/a' : `${dist.mean.toFixed(3)} ± ${dist.stdev.toFixed(3)}`;
      };

      lines.push(
        `| \`${arm.arm}\` | ${cell('@1')} | ${cell('@5')} | ${cell('@10')} | ${cell('@20')} | ` +
          `${arm.precisionAt10.mean.toFixed(3)} | ${arm.mrr.mean.toFixed(3)} |`,
      );
    }

    lines.push('', 'Cells are mean ± sample standard deviation across the evaluated commits.', '');
  }

  return lines.join('\n');
}
