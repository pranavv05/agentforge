/**
 * Scoring.
 *
 * All of it pure, so a results table can be recomputed from the raw per-commit records
 * without re-running anything.
 *
 * Two choices worth stating, because they decide what the headline numbers mean:
 *
 * - **recall@k, not precision.** The retriever's job is to put the files a feature
 *   touches in front of the agent; a file it offers that the commit did not touch is
 *   cheap (the agent reads and discards it), whereas a file it misses is invisible for
 *   the rest of the run. The two are not symmetric, so the metric is not either.
 * - **Mean and spread, never a single run.** One cherry-picked commit proves nothing, so
 *   `summarise` reports the spread alongside the mean and refuses to hide an n of 1.
 */

/** Recall@k: the fraction of gold files appearing in the first k retrieved paths. */
export function recallAtK(
  retrieved: readonly string[],
  gold: readonly string[],
  k: number,
): number {
  if (gold.length === 0) return 0;

  // k counts *distinct* paths: duplicates are collapsed first, then the top k taken.
  // Every arm here builds its ranking from a map keyed by path and so cannot emit a
  // duplicate, which makes this choice irrelevant to any reported figure — but it has to
  // be defined, because "the first k results" and "the first k distinct results" differ
  // for anything that can repeat itself.
  const topK = [...new Set(retrieved.map(normalisePath))].slice(0, k);
  const goldSet = new Set(gold.map(normalisePath));

  const hits = topK.filter((path) => goldSet.has(path)).length;
  return hits / goldSet.size;
}

/** Precision@k, reported alongside recall so the trade-off is visible rather than hidden. */
export function precisionAtK(
  retrieved: readonly string[],
  gold: readonly string[],
  k: number,
): number {
  const topK = [...new Set(retrieved.map(normalisePath))].slice(0, k);
  if (topK.length === 0) return 0;

  const goldSet = new Set(gold.map(normalisePath));
  return topK.filter((path) => goldSet.has(path)).length / topK.length;
}

/**
 * Mean reciprocal rank: 1/rank of the first gold file found, 0 if none is.
 *
 * Reported because recall@10 cannot tell a retriever that ranked the right file first
 * from one that ranked it tenth, and that difference matters to an agent spending a
 * finite tool budget.
 */
export function reciprocalRank(retrieved: readonly string[], gold: readonly string[]): number {
  const goldSet = new Set(gold.map(normalisePath));
  const seen = [...new Set(retrieved.map(normalisePath))];

  for (const [index, path] of seen.entries()) {
    if (goldSet.has(path)) return 1 / (index + 1);
  }
  return 0;
}

/** Windows paths and leading `./` both show up in real inputs; neither should miss a match. */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export interface Distribution {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** Sample standard deviation, or 0 when n < 2 — there is no spread in one sample. */
  readonly stdev: number;
}

export function summarise(values: readonly number[]): Distribution {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, min: 0, max: 0, stdev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / n;

  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;

  // Sample standard deviation (n-1). With one observation there is no spread to report,
  // and dividing by zero would make it look like certainty.
  const variance =
    n < 2 ? 0 : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);

  return {
    n,
    mean,
    median,
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    stdev: Math.sqrt(variance),
  };
}

/** Formats a distribution as `mean ± stdev (n=…)`, or names an n of 1 for what it is. */
export function formatDistribution(dist: Distribution, digits = 3): string {
  if (dist.n === 0) return 'no data';
  if (dist.n === 1) return `${dist.mean.toFixed(digits)} (single run, no spread)`;
  return `${dist.mean.toFixed(digits)} ± ${dist.stdev.toFixed(digits)} (n=${String(dist.n)})`;
}
