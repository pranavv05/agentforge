/**
 * The agentic retrieval ablation, from the command line.
 *
 *   npm run eval:agentic -- <repo> [<repo>...] [options]
 *
 *     --commits N         feature commits per repository            (default 15)
 *     --arms a,b,c        which arms to run                          (default: all four)
 *     --concurrency N     commits evaluated at once                  (default 3)
 *     --budget USD        total spend, counting the journal's history (default 4.00)
 *     --run-cap USD       the most any single run may spend           (default 0.15)
 *     --max-tool-calls N  the agent's tool-call ceiling               (default 25)
 *     --model ID          the Context Agent's model                   (default claude-haiku-5-5)
 *     --out DIR           where results, the journal and cassettes go (default ./eval-agentic)
 *
 * BILLABLE. Every run is a real Context Agent loop on a real model. Expect roughly $0.015 per
 * run, so 15 commits x 2 repositories x 4 arms is about 120 runs and a couple of dollars.
 *
 * Safe to interrupt and re-run: each completed run is appended to `journal.jsonl` the moment
 * it finishes, and a re-run skips anything already in it, so paid work is never repeated. The
 * budget counts what the journal already holds, so resuming cannot overspend it either.
 *
 * It uses the same mined commits and the same leakage-controlled worktrees as the free
 * deterministic ablation (`npm run eval`), so the two tables are directly comparable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RETRIEVAL_STRATEGIES, type RetrievalStrategy } from '@agentforge/context-agent';
import { loadEnvFile } from '@agentforge/llm';
import {
  recallAtK,
  renderAgentic,
  runAgenticAblation,
  scoreAgentic,
  type AgenticRunRecord,
} from '@agentforge/eval';

loadEnvFile();

const args = process.argv.slice(2);

/** Reads `--name value`, removing both from the list. */
function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return undefined;

  const value = args[at + 1];
  args.splice(at, value === undefined ? 1 : 2);
  return value;
}

function positive(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} must be a positive number, received "${raw}"`);
    process.exit(2);
  }
  return value;
}

const commits = Math.floor(positive('commits', flag('commits'), 15));
const concurrency = Math.floor(positive('concurrency', flag('concurrency'), 3));
const budget = positive('budget', flag('budget'), 4);
const runCap = positive('run-cap', flag('run-cap'), 0.15);
const maxToolCalls = Math.floor(positive('max-tool-calls', flag('max-tool-calls'), 25));
const model = flag('model') ?? 'claude-haiku-5-5';
const out = resolve(flag('out') ?? 'eval-agentic');
const armsArg = flag('arms');

const arms: readonly RetrievalStrategy[] =
  armsArg === undefined
    ? RETRIEVAL_STRATEGIES
    : armsArg.split(',').map((name) => {
        const match = RETRIEVAL_STRATEGIES.find((arm) => arm === name.trim());
        if (match === undefined) {
          console.error(`unknown arm "${name}"; choose from ${RETRIEVAL_STRATEGIES.join(', ')}`);
          process.exit(2);
        }
        return match;
      });

const repoPaths = args.filter((arg) => !arg.startsWith('--')).map((arg) => resolve(arg));
if (repoPaths.length === 0) {
  console.error(
    'usage: npm run eval:agentic -- <repo> [<repo>...] [--commits N] [--budget USD] ...',
  );
  process.exit(2);
}

// Set unconditionally. The development .env pins these, `loadEnvFile()` has already loaded it,
// and `??=` would therefore leave the pinned value in place — which is how a smoke run once
// said "Sonnet" and silently used Haiku. An experiment must run on the model it reports.
process.env['SDD_MODEL_CONTEXT'] = model;
process.env['SDD_RUN_COST_CAP_USD'] = String(runCap);
// Recorded, outside the repository, so the whole experiment can be re-scored offline for free.
process.env['SDD_CASSETTE_MODE'] = 'record';
process.env['SDD_CASSETTE_DIR'] = join(out, 'cassettes');
// A throwaway database per run holds the spec; the eval never touches development data.

mkdirSync(out, { recursive: true });
const journalPath = join(out, 'journal.jsonl');

console.log('# Agentic retrieval ablation\n');
console.log(`- repositories: ${repoPaths.join(', ')}`);
console.log(`- arms: ${arms.join(', ')}`);
console.log(`- commits per repository: ${String(commits)}`);
console.log(`- model: ${model}`);
console.log(`- tool-call ceiling: ${String(maxToolCalls)}`);
console.log(`- per-run cap: $${runCap.toFixed(2)}   total budget: $${budget.toFixed(2)}`);
console.log(`- concurrency: ${String(concurrency)}`);
console.log(`- journal: ${journalPath}\n`);

let counter = 0;

const outcome = await runAgenticAblation({
  repoPaths,
  commitsPerRepo: commits,
  arms,
  maxToolCalls,
  journalPath,
  totalBudgetUsd: budget,
  runCapUsd: runCap,
  concurrency,
  model,
  onRecord: (record: AgenticRunRecord, spent: number) => {
    counter += 1;
    const hit10 = recallAtK(record.cited, record.scorableFiles, 10);
    console.log(
      `[${String(counter).padStart(3)}] ${record.repo} ${record.sha.slice(0, 7)} ` +
        `${record.arm.padEnd(11)} ` +
        (record.error === null
          ? `recall@10 ${hit10.toFixed(2)}  cited ${String(record.cited.length).padStart(2)}  ` +
            `tools ${String(record.toolCalls).padStart(2)}  $${record.costUsd.toFixed(4)}  ` +
            `${(record.wallMs / 1000).toFixed(0)}s`
          : `FAILED  $${record.costUsd.toFixed(4)}  ${record.error.slice(0, 90)}`) +
        `   (running total $${spent.toFixed(4)})`,
    );
  },
});

const result = scoreAgentic(outcome.records, arms, model);

writeFileSync(join(out, 'agentic-results.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(out, 'agentic-results.md'), renderAgentic(result));

console.log(`\n${renderAgentic(result)}`);
console.log(`wrote ${join(out, 'agentic-results.json')}`);
console.log(`wrote ${join(out, 'agentic-results.md')}`);

if (outcome.budgetStopped) {
  console.log(
    `\nSTOPPED by the budget at $${outcome.spentUsd.toFixed(4)} of $${budget.toFixed(2)}. ` +
      'Results are partial: re-run with a higher --budget to resume from the journal.',
  );
  process.exitCode = 3;
}
