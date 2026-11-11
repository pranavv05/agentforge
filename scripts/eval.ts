/**
 * Runs the retrieval ablation and writes the results.
 *
 *   npm run eval -- <repo> [<repo>...] [--commits 12] [--limit 20] [--out dir]
 *
 * Needs no API key and costs nothing: every arm here is deterministic. That is the point
 * — it can run over every mined commit, so the numbers come with a spread instead of
 * being one run that happened to look good.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderResults, runAblation } from '@agentforge/eval';
import { DETERMINISTIC_ARMS } from '@agentforge/eval';

const args = process.argv.slice(2);

/** Reads `--name value`, removing both from the list. */
function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return undefined;
  const value = args[at + 1];
  args.splice(at, value === undefined ? 1 : 2);
  return value;
}

const commits = Number(flag('commits') ?? '12');
const limit = Number(flag('limit') ?? '20');
const outDir = resolve(flag('out') ?? 'packages/eval/results');

const repoPaths = args.filter((arg) => !arg.startsWith('--')).map((arg) => resolve(arg));

if (repoPaths.length === 0) {
  console.error('usage: npm run eval -- <repo> [<repo>...] [--commits N] [--limit N] [--out dir]');
  process.exit(2);
}

if (!Number.isInteger(commits) || commits < 1) {
  console.error(`--commits must be a positive integer, received "${String(commits)}"`);
  process.exit(2);
}
if (!Number.isInteger(limit) || limit < 1) {
  console.error(`--limit must be a positive integer, received "${String(limit)}"`);
  process.exit(2);
}

console.log('# Retrieval ablation\n');
console.log(`- repositories: ${String(repoPaths.length)}`);
console.log(`- feature commits per repository: up to ${String(commits)}`);
console.log(`- retrieval depth: ${String(limit)}`);
console.log(`- arms: ${DETERMINISTIC_ARMS.join(', ')}`);
console.log('- cost: $0 — no model is involved in any arm\n');

const result = await runAblation({ repoPaths, commitsPerRepo: commits, limit });

mkdirSync(outDir, { recursive: true });

const jsonPath = resolve(outDir, 'results.json');
const mdPath = resolve(outDir, 'results.md');

// The raw per-commit rankings are kept, so every figure in the table can be recomputed
// without re-running anything — and checked by someone who does not trust the summary.
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const markdown = renderResults(result);
writeFileSync(mdPath, markdown, 'utf8');

console.log(markdown);
console.log(`\nwrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
