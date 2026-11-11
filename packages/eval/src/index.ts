/**
 * `@agentforge/eval` — the measurement harness.
 *
 * Mines ground truth from git history, runs the retrieval ablation against it, and
 * scores recall. The deterministic arms need no API key and cost nothing, which is what
 * lets them run over every mined commit and report a mean with a spread rather than one
 * run anybody could have cherry-picked.
 */

export {
  checkoutParent,
  isGitRepository,
  isSourceFile,
  mineFeatureCommits,
  type FeatureCommit,
  type MineOptions,
  type Worktree,
} from './mine.ts';

export {
  formatDistribution,
  normalisePath,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  summarise,
  type Distribution,
} from './metrics.ts';

export {
  DETERMINISTIC_ARMS,
  prepareRepo,
  queryTerms,
  retrieve,
  type DeterministicArm,
  type PreparedRepo,
} from './retrieval.ts';

export {
  K_VALUES,
  renderResults,
  runAblation,
  type ArmSummary,
  type CommitResult,
  type EvalResult,
  type RepoResult,
  type RunOptions,
} from './run.ts';
