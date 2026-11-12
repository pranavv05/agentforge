import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { ValidationError, type ContextEvidence } from '@agentforge/contract';
import {
  RETRIEVAL_STRATEGIES,
  scanContext,
  type RetrievalStrategy,
} from '@agentforge/context-agent';
import { createDb } from '@agentforge/db';
import {
  createSpec,
  getCostSummary,
  logger,
  transition,
  type Actor,
} from '@agentforge/orchestrator';
import { checkoutParent, isGitRepository, mineFeatureCommits, type FeatureCommit } from './mine.ts';
import {
  normalisePath,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  summarise,
  type Distribution,
} from './metrics.ts';
import { K_VALUES } from './run.ts';

/**
 * The agentic ablation.
 *
 * The deterministic ablation (`run.ts`) ranks files with no model in the loop. It is free
 * and exactly reproducible, but it measures *retrieval*, not the system as people use it:
 * the real question is what a model equipped with each set of tools actually finds. This
 * runs the full Context Agent — the budgeted tool loop, the verifier and all — once per arm
 * per feature commit, against the same mined commits and the same leakage-controlled
 * worktrees as the deterministic table, so the two can be read side by side.
 *
 * What is scored. Recall is measured over the files the agent **cited in verified claims**,
 * because that is what survives into a spec: a file it read but never cited does not reach
 * a document, and a claim the verifier rejected is, by definition, not evidence. The cited
 * files are ranked in the order the agent emitted them. `relevance` on an evidence row is
 * free text, not a score, so there is no better ordering available — which means recall@1,
 * @5 and MRR depend on the agent's own habit of listing the best file first, and recall@10
 * and @20 (which are set membership at a depth) are the figures to trust.
 *
 * What is held constant. Module summaries are skipped. They are an LLM-written digest of the
 * whole repository handed to every arm alike, and including them would confound a comparison
 * whose point is what the *retrieval tools* are worth.
 *
 * How it spends money. Every run is appended to a journal the moment it finishes, so an
 * interruption never loses paid work and a re-run resumes where it stopped. A total budget
 * stops new runs from being scheduled, and a per-run cap bounds any single misbehaving one.
 */

const HARNESS: Actor = { id: 'eval-harness@agentforge.local', type: 'human' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

/** One arm run against one commit: everything needed to rescore it later without paying. */
export const AgenticRunRecordSchema = z.strictObject({
  key: z.string().min(1),
  repo: z.string().min(1),
  sha: z.string().min(1),
  subject: z.string(),
  arm: z.enum(RETRIEVAL_STRATEGIES),
  /** The files this commit modified that existed in the parent: the denominator. */
  scorableFiles: z.array(z.string()),
  /** Distinct files cited by *verified* claims, in the order the agent emitted them. */
  cited: z.array(z.string()),
  totalClaims: z.number().int().nonnegative(),
  verifiedClaims: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  budgetExhausted: z.boolean(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  wallMs: z.number().nonnegative(),
  model: z.string(),
  /** Null for a completed run. A failed run is recorded, with the money it still cost. */
  error: z.string().nullable(),
});

export type AgenticRunRecord = z.infer<typeof AgenticRunRecordSchema>;

/** The query an arm is given: the commit subject, plus the body when there is one. */
export function queryFor(commit: Pick<FeatureCommit, 'subject' | 'body'>): string {
  return commit.body.length > 0 ? `${commit.subject}\n\n${commit.body}` : commit.subject;
}

/**
 * The files an agent's *verified* evidence points at, in the order it listed them.
 *
 * Unverified claims are excluded: a citation the verifier rejected is not evidence, and
 * counting it would credit an arm for a hallucination that happened to name a real file.
 */
export function citedFiles(evidence: readonly ContextEvidence[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const item of evidence) {
    if (!item.verified) continue;
    const path = normalisePath(item.file);
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }

  return ordered;
}

export function runKey(repo: string, sha: string, arm: string): string {
  return `${repo}|${sha}|${arm}`;
}

// ---------------------------------------------------------------------------------- journal

/**
 * Reads the journal, validating every line.
 *
 * A malformed line throws rather than being skipped. These are paid results, and a journal
 * that quietly drops a line it could not read would let a resume silently re-run (and
 * re-pay for) work that was already done, or report a table missing rows nobody can find.
 */
export function readJournal(path: string): readonly AgenticRunRecord[] {
  if (!existsSync(path)) return [];

  const records: AgenticRunRecord[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (line.trim().length === 0) return;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (cause) {
      throw new ValidationError(`journal line ${String(index + 1)} is not valid JSON`, {
        path,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const parsed = AgenticRunRecordSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError(`journal line ${String(index + 1)} does not match the schema`, {
        path,
        issues: parsed.error.issues.slice(0, 3).map((issue) => issue.message),
      });
    }
    records.push(parsed.data);
  });

  return records;
}

function appendRecord(path: string, record: AgenticRunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(AgenticRunRecordSchema.parse(record))}\n`);
}

// ---------------------------------------------------------------------------------- running

export interface AgenticOptions {
  readonly repoPaths: readonly string[];
  readonly commitsPerRepo: number;
  readonly arms?: readonly RetrievalStrategy[];
  /** Per-run ceiling on the Context Agent's tool calls. */
  readonly maxToolCalls?: number;
  /** Where results are appended as they complete, and where a re-run resumes from. */
  readonly journalPath: string;
  /** Stops *scheduling* new runs once spend would pass this. Counts the journal's history. */
  readonly totalBudgetUsd: number;
  /** The most one run may spend. Must be set in the environment by the caller too. */
  readonly runCapUsd: number;
  /** Feature commits evaluated at once. Each commit's arms run one after another. */
  readonly concurrency: number;
  readonly model: string;
  readonly onRecord?: (record: AgenticRunRecord, spentUsd: number) => void;
}

export interface AgenticOutcome {
  readonly records: readonly AgenticRunRecord[];
  readonly plannedCommits: number;
  /** True when the budget stopped the run before every planned run was attempted. */
  readonly budgetStopped: boolean;
  readonly spentUsd: number;
}

/** Runs one arm against one prepared worktree, and never throws: a failure is a record. */
async function runOneArm(
  worktreePath: string,
  repo: string,
  commit: FeatureCommit,
  scorableFiles: readonly string[],
  arm: RetrievalStrategy,
  options: AgenticOptions,
): Promise<AgenticRunRecord> {
  const key = runKey(repo, commit.sha, arm);
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-agentic-'));
  const db = createDb(join(dir, 'run.db'));
  const started = Date.now();

  let specId: string | null = null;

  try {
    const spec = createSpec(db, {
      title: commit.subject.slice(0, 300),
      description: queryFor(commit).slice(0, 20_000),
      mode: 'brownfield',
      repo_path: worktreePath,
      actor: HARNESS,
    });
    specId = spec.id;

    transition(db, {
      specId: spec.id,
      from: 'CREATED',
      to: 'CONTEXT_SCANNING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    const result = await scanContext(db, {
      specId: spec.id,
      idempotencyKey: key,
      strategy: arm,
      ...(options.maxToolCalls === undefined ? {} : { maxToolCalls: options.maxToolCalls }),
      skipModuleSummaries: true,
    });

    const cost = getCostSummary(db, spec.id);
    const stats = result.bundle.stats;

    return {
      key,
      repo,
      sha: commit.sha,
      subject: commit.subject,
      arm,
      scorableFiles: [...scorableFiles],
      cited: [...citedFiles(result.bundle.evidence)],
      totalClaims: stats.total_claims,
      verifiedClaims: stats.verified_claims,
      toolCalls: result.toolCallsUsed,
      budgetExhausted: result.budgetExhausted,
      costUsd: cost.total_cost_usd,
      inputTokens: cost.total_input_tokens,
      outputTokens: cost.total_output_tokens,
      cacheReadTokens: cost.total_cache_read_tokens,
      cacheWriteTokens: cost.total_cache_creation_tokens,
      wallMs: Date.now() - started,
      model: options.model,
      error: null,
    };
  } catch (error) {
    // A failed run is data. It is recorded with whatever it spent before failing, because
    // that money is gone and the budget has to know — and because dropping it would make
    // an arm that fails often look cheaper and no worse than one that does not.
    const cost = specId === null ? null : getCostSummary(db, specId);

    return {
      key,
      repo,
      sha: commit.sha,
      subject: commit.subject,
      arm,
      scorableFiles: [...scorableFiles],
      cited: [],
      totalClaims: 0,
      verifiedClaims: 0,
      toolCalls: 0,
      budgetExhausted: false,
      costUsd: cost?.total_cost_usd ?? 0,
      inputTokens: cost?.total_input_tokens ?? 0,
      outputTokens: cost?.total_output_tokens ?? 0,
      cacheReadTokens: cost?.total_cache_read_tokens ?? 0,
      cacheWriteTokens: cost?.total_cache_creation_tokens ?? 0,
      wallMs: Date.now() - started,
      model: options.model,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  } finally {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;

  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => lane()));
}

export async function runAgenticAblation(options: AgenticOptions): Promise<AgenticOutcome> {
  const arms = options.arms ?? RETRIEVAL_STRATEGIES;
  const journal = [...readJournal(options.journalPath)];
  const done = new Set(journal.map((record) => record.key));

  let spentUsd = journal.reduce((sum, record) => sum + record.costUsd, 0);
  let budgetStopped = false;

  interface Job {
    readonly repoPath: string;
    readonly repo: string;
    readonly commit: FeatureCommit;
  }

  const jobs: Job[] = [];
  for (const repoPath of options.repoPaths) {
    if (!isGitRepository(repoPath)) {
      throw new ValidationError(
        `${repoPath} is not a git checkout, so no ground truth can be mined from it`,
        { repo_path: repoPath },
      );
    }

    // The very same call the deterministic ablation makes, so the commits are identical.
    for (const commit of mineFeatureCommits(repoPath, { limit: options.commitsPerRepo })) {
      jobs.push({ repoPath, repo: basename(repoPath), commit });
    }
  }

  await pool(jobs, options.concurrency, async ({ repoPath, repo, commit }) => {
    const pending = arms.filter((arm) => !done.has(runKey(repo, commit.sha, arm)));
    if (pending.length === 0) return;

    const worktreeDir = mkdtempSync(join(tmpdir(), 'agentforge-agentic-wt-'));
    // `mkdtemp` created it, but `git worktree add` wants to create the path itself.
    rmSync(worktreeDir, { recursive: true, force: true });

    let worktree;
    try {
      worktree = checkoutParent(repoPath, commit.sha, worktreeDir);
    } catch (error) {
      logger.warn(
        { sha: commit.sha, error: error instanceof Error ? error.message : String(error) },
        'could not check out the parent commit; skipping',
      );
      return;
    }

    try {
      // Scored against what existed in the parent and was modified, exactly as the
      // deterministic ablation does. A commit that only created files has nothing an arm
      // could have found, so it is skipped rather than scored as an impossible zero.
      const scorableFiles = commit.modifiedFiles
        .map(normalisePath)
        .filter((path) => existsSync(join(worktree.path, path)));

      if (scorableFiles.length === 0) {
        logger.info({ sha: commit.sha }, 'commit only created files; skipping');
        return;
      }

      for (const arm of pending) {
        // The budget is checked before every run, not once up front: concurrent commits
        // are all spending, and a check at the start would let the whole pool overshoot.
        if (spentUsd + options.runCapUsd > options.totalBudgetUsd) {
          budgetStopped = true;
          return;
        }

        const record = await runOneArm(worktree.path, repo, commit, scorableFiles, arm, options);

        spentUsd += record.costUsd;
        journal.push(record);
        done.add(record.key);
        appendRecord(options.journalPath, record);
        options.onRecord?.(record, spentUsd);
      }
    } finally {
      worktree.cleanup();
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  return {
    records: journal,
    plannedCommits: jobs.length,
    budgetStopped,
    spentUsd,
  };
}

// ---------------------------------------------------------------------------------- scoring

export interface AgenticArmSummary {
  readonly arm: string;
  /** Commits where every arm completed, so arms are compared on identical ground. */
  readonly commits: number;
  readonly recall: Readonly<Record<string, Distribution>>;
  readonly precisionAt10: Distribution;
  readonly mrr: Distribution;
  readonly costUsd: Distribution;
  readonly toolCalls: Distribution;
  readonly citedFiles: Distribution;
  /** 0 when the agent made no claims at all, which is a failure to cite, not a clean run. */
  readonly unverifiedClaimRate: Distribution;
  readonly wallSeconds: Distribution;
  /** Share of input tokens served from cache, across this arm's complete-case runs. */
  readonly cacheHitRate: number;
  readonly budgetExhausted: number;
  /** Failed attempts over *all* commits, not just complete cases. */
  readonly errors: number;
  readonly attempts: number;
}

export interface AgenticRepoResult {
  readonly repo: string;
  readonly commitsAttempted: number;
  readonly commitsComplete: number;
  readonly arms: readonly AgenticArmSummary[];
}

export interface AgenticResult {
  readonly experiment: {
    readonly description: string;
    readonly arms: readonly string[];
    readonly model: string;
    readonly k_values: readonly number[];
    readonly scoring: string;
    readonly held_constant: string;
  };
  readonly repos: readonly AgenticRepoResult[];
  readonly totals: { readonly runs: number; readonly errors: number; readonly costUsd: number };
}

function unverifiedRate(record: AgenticRunRecord): number {
  return record.totalClaims === 0 ? 0 : 1 - record.verifiedClaims / record.totalClaims;
}

export function scoreAgentic(
  records: readonly AgenticRunRecord[],
  arms: readonly string[],
  model: string,
): AgenticResult {
  const byRepo = new Map<string, AgenticRunRecord[]>();
  for (const record of records) {
    byRepo.set(record.repo, [...(byRepo.get(record.repo) ?? []), record]);
  }

  const repos: AgenticRepoResult[] = [];

  for (const [repo, rows] of byRepo) {
    const bySha = new Map<string, AgenticRunRecord[]>();
    for (const row of rows) bySha.set(row.sha, [...(bySha.get(row.sha) ?? []), row]);

    // Complete cases: every arm produced a result without error for this commit.
    const complete = [...bySha.values()].filter((group) =>
      arms.every((arm) => group.some((row) => row.arm === arm && row.error === null)),
    );

    const summaries = arms.map((arm): AgenticArmSummary => {
      const mine = complete.flatMap((group) => group.filter((row) => row.arm === arm));
      const attemptedByArm = rows.filter((row) => row.arm === arm);

      const recall: Record<string, Distribution> = {};
      for (const k of K_VALUES) {
        recall[`@${String(k)}`] = summarise(
          mine.map((row) => recallAtK(row.cited, row.scorableFiles, k)),
        );
      }

      const input = mine.reduce((n, row) => n + row.inputTokens, 0);
      const read = mine.reduce((n, row) => n + row.cacheReadTokens, 0);
      const write = mine.reduce((n, row) => n + row.cacheWriteTokens, 0);

      return {
        arm,
        commits: mine.length,
        recall,
        precisionAt10: summarise(mine.map((row) => precisionAtK(row.cited, row.scorableFiles, 10))),
        mrr: summarise(mine.map((row) => reciprocalRank(row.cited, row.scorableFiles))),
        costUsd: summarise(mine.map((row) => row.costUsd)),
        toolCalls: summarise(mine.map((row) => row.toolCalls)),
        citedFiles: summarise(mine.map((row) => row.cited.length)),
        unverifiedClaimRate: summarise(mine.map(unverifiedRate)),
        wallSeconds: summarise(mine.map((row) => row.wallMs / 1000)),
        cacheHitRate: input + read + write === 0 ? 0 : read / (input + read + write),
        budgetExhausted: mine.filter((row) => row.budgetExhausted).length,
        errors: attemptedByArm.filter((row) => row.error !== null).length,
        attempts: attemptedByArm.length,
      };
    });

    repos.push({
      repo,
      commitsAttempted: bySha.size,
      commitsComplete: complete.length,
      arms: summaries,
    });
  }

  return {
    experiment: {
      description:
        'Agentic retrieval ablation. For each feature commit mined from git history, the full ' +
        'Context Agent runs once per arm with that arm’s tool set, against the commit’s parent in ' +
        'a detached worktree, given the commit subject (and body) as the feature request.',
      arms: [...arms],
      model,
      k_values: [...K_VALUES],
      scoring:
        'Recall is scored over the files the agent cited in verified claims, in the order it ' +
        'emitted them, against the pre-existing files the commit modified. Only commits where ' +
        'every arm completed are scored, so arms are compared on identical ground; failed ' +
        'attempts are counted separately. Evidence relevance is free text, not a score, so ' +
        'recall@1, @5 and MRR depend on the agent listing its best file first; recall@10 and ' +
        '@20 are set membership at a depth and are the figures to trust.',
      held_constant:
        'Module summaries are skipped, so every arm gets only its tools. Same model, same ' +
        'tool-call ceiling, one run per arm per commit.',
    },
    repos,
    totals: {
      runs: records.length,
      errors: records.filter((row) => row.error !== null).length,
      costUsd: records.reduce((sum, row) => sum + row.costUsd, 0),
    },
  };
}

// ---------------------------------------------------------------------------------- rendering

function cell(dist: Distribution, digits = 3): string {
  if (dist.n === 0) return 'n/a';
  return `${dist.mean.toFixed(digits)} ± ${dist.stdev.toFixed(digits)}`;
}

export function renderAgentic(result: AgenticResult): string {
  const lines: string[] = [
    '# Agentic retrieval ablation',
    '',
    result.experiment.description,
    '',
    `**Model.** ${result.experiment.model}.`,
    '',
    `**Scoring.** ${result.experiment.scoring}`,
    '',
    `**Held constant.** ${result.experiment.held_constant}`,
    '',
    `**Spend.** $${result.totals.costUsd.toFixed(4)} across ${String(result.totals.runs)} runs ` +
      `(${String(result.totals.errors)} failed).`,
    '',
  ];

  for (const repo of result.repos) {
    lines.push(
      `## ${repo.repo}`,
      '',
      `- commits attempted: ${String(repo.commitsAttempted)}`,
      `- commits where every arm completed (scored): ${String(repo.commitsComplete)}`,
      '',
      '| arm | recall@1 | recall@5 | recall@10 | recall@20 | precision@10 | MRR |',
      '|---|---|---|---|---|---|---|',
    );

    for (const arm of repo.arms) {
      lines.push(
        `| \`${arm.arm}\` | ${cell(arm.recall['@1'] ?? summarise([]))} | ` +
          `${cell(arm.recall['@5'] ?? summarise([]))} | ${cell(arm.recall['@10'] ?? summarise([]))} | ` +
          `${cell(arm.recall['@20'] ?? summarise([]))} | ${arm.precisionAt10.mean.toFixed(3)} | ` +
          `${arm.mrr.mean.toFixed(3)} |`,
      );
    }

    lines.push(
      '',
      'Cells are mean ± sample standard deviation across the scored commits.',
      '',
      '| arm | cost / run | tool calls | files cited | unverified-claim rate | cache hit | budget hit | failed attempts |',
      '|---|---|---|---|---|---|---|---|',
    );

    for (const arm of repo.arms) {
      lines.push(
        `| \`${arm.arm}\` | $${arm.costUsd.mean.toFixed(4)} | ${arm.toolCalls.mean.toFixed(1)} | ` +
          `${arm.citedFiles.mean.toFixed(1)} | ${(arm.unverifiedClaimRate.mean * 100).toFixed(1)}% | ` +
          `${(arm.cacheHitRate * 100).toFixed(1)}% | ${String(arm.budgetExhausted)} | ` +
          `${String(arm.errors)} of ${String(arm.attempts)} |`,
      );
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
