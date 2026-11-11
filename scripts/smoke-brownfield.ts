/**
 * Live Case B: run the Context Agent over a real repository.
 *
 *   npm run sdd:smoke:brownfield -- <repo-path> [feature request...]
 *
 * Drives a brownfield spec from CONTEXT_SCANNING to CONTEXT_READY against the live API:
 * the deterministic scan, cached module summaries, the budgeted agentic loop, and then
 * the grounding verifier. It prints every claim with its verification verdict, the
 * unverified-claim rate, and the measured cost.
 *
 * This is the only thing that can tell us whether the loop actually finds the right code
 * in a repository it has never seen. The offline suite proves the machinery; it cannot
 * prove the retrieval works.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, schema } from '@agentforge/db';
import { scanContext } from '@agentforge/context-agent';
import { loadEnvFile, maxToolCalls, resolveProvider } from '@agentforge/llm';
import {
  createSpec,
  getCostSummary,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  transition,
  type Actor,
} from '@agentforge/orchestrator';
import { eq } from 'drizzle-orm';

loadEnvFile();

const HUMAN: Actor = { id: 'smoke@agentforge.local', type: 'human' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

const [repoArg, ...requestWords] = process.argv.slice(2);
if (repoArg === undefined) {
  console.error('usage: npm run sdd:smoke:brownfield -- <repo-path> [feature request...]');
  process.exit(2);
}

const repoPath = resolve(repoArg);
const request =
  requestWords.length > 0
    ? requestWords.join(' ')
    : 'Notify an external system over HTTP whenever a spec artifact is approved, with ' +
      'retries, so an approval can trigger a downstream build.';

const provider = resolveProvider();
console.log('# Live Case B: brownfield context scan\n');
console.log(`- repository: ${repoPath}`);
console.log(`- gateway: ${provider.name}`);
console.log(`- tool-call budget: ${String(maxToolCalls())}`);
console.log(`- feature: ${request}\n`);

const dir = mkdtempSync(join(tmpdir(), 'agentforge-smoke-bf-'));
const db = createDb(join(dir, 'smoke.db'));

try {
  const spec = createSpec(db, {
    title: 'Approval webhook',
    description: request,
    mode: 'brownfield',
    repo_path: repoPath,
    actor: HUMAN,
  });

  transition(db, {
    specId: spec.id,
    from: 'CREATED',
    to: 'CONTEXT_SCANNING',
    actor: ORCHESTRATOR,
    expectedVersion: spec.version,
  });

  console.log('## Exploration\n');

  const result = await scanContext(db, {
    specId: spec.id,
    idempotencyKey: 'smoke-brownfield-1',
    strategy: 'fts_repomap',
    onToolCall: (invocation) => {
      // The budget bar, in text: this is what the SSE stream shows the user.
      console.log(`  [${String(invocation.index)}] ${invocation.name}`);
    },
  });

  console.log(`\n## Stage 1: module summaries\n`);
  for (const summary of result.moduleSummaries) {
    const mark = summary.cached ? 'cached' : 'generated';
    console.log(`- ${summary.modulePath} (${String(summary.fileCount)} files, ${mark})`);
  }

  console.log(`\n## Summary\n`);
  console.log(result.bundle.summary);

  console.log(`\n## Claims, with verification verdicts\n`);
  for (const item of result.bundle.evidence) {
    const range = `${item.file}:${String(item.line_start)}-${String(item.line_end)}`;
    const verdict = item.verified ? 'VERIFIED' : `FAILED (${item.failure_reason ?? 'unknown'})`;
    console.log(`- [${verdict}] ${range}${item.symbol === null ? '' : ` — ${item.symbol}`}`);
    console.log(`    ${item.claim}`);
  }

  if (result.bundle.touched_modules.length > 0) {
    console.log(`\n## Modules the agent believes are touched\n`);
    for (const module of result.bundle.touched_modules) console.log(`- ${module}`);
  }

  if (result.bundle.open_questions.length > 0) {
    console.log(`\n## Open questions\n`);
    for (const question of result.bundle.open_questions) console.log(`- ${question}`);
  }

  // --- The headline metric ----------------------------------------------
  const stats = result.bundle.stats;
  console.log(`\n## Grounding\n`);
  console.log(`- claims: ${String(stats.total_claims)}`);
  console.log(`- verified: ${String(stats.verified_claims)}`);
  console.log(`- unverified: ${String(stats.unverified_claims)}`);
  console.log(`- **unverified-claim rate: ${(stats.unverified_claim_rate * 100).toFixed(1)}%**`);
  console.log(`- tool calls used: ${String(stats.tool_calls_used)} of ${String(maxToolCalls())}`);
  console.log(`- budget exhausted: ${String(result.budgetExhausted)}`);

  console.log(`\n## Outcome\n`);
  console.log(`- final state: ${getSpec(db, spec.id)?.status ?? 'unknown'}`);
  console.log(
    `- audit trail: ${listAuditEntries(db, spec.id)
      .map((entry) => entry.toState)
      .join(' -> ')}`,
  );

  const rows = db
    .select({
      stage: schema.llmCalls.stage,
      input: schema.llmCalls.inputTokens,
      output: schema.llmCalls.outputTokens,
      cacheRead: schema.llmCalls.cacheReadInputTokens,
      cacheWrite: schema.llmCalls.cacheCreationInputTokens,
      costUsd: schema.llmCalls.costUsd,
    })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.specId, spec.id))
    .all();

  const byStage = new Map<string, { calls: number; cost: number; read: number; write: number }>();
  for (const row of rows) {
    const current = byStage.get(row.stage) ?? { calls: 0, cost: 0, read: 0, write: 0 };
    byStage.set(row.stage, {
      calls: current.calls + 1,
      cost: current.cost + row.costUsd,
      read: current.read + row.cacheRead,
      write: current.write + row.cacheWrite,
    });
  }

  console.log(`\n## Measured cost\n`);
  for (const [stage, totals] of byStage) {
    console.log(
      `- ${stage}: ${String(totals.calls)} call(s), $${totals.cost.toFixed(6)}, ` +
        `cache read ${String(totals.read)} / written ${String(totals.write)}`,
    );
  }

  const cost = getCostSummary(db, spec.id);
  console.log(
    `\n- total: $${cost.total_cost_usd.toFixed(6)} across ${String(cost.call_count)} call(s)`,
  );
  console.log(`- cache hit rate: ${(cost.cache_hit_rate * 100).toFixed(1)}%`);

  const artifact = getHeadArtifact(db, spec.id, 'context');
  console.log(
    `\n- context artifact: v${String(artifact?.version ?? 0)} at ${(artifact?.contentHash ?? '').slice(0, 12)}`,
  );
} finally {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
}
