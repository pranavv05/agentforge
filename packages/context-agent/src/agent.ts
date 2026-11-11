import {
  ContextProposalSchema,
  type ContextBundle,
  RETRIEVAL_STRATEGY_NAMES,
  type RetrievalStrategyName,
  TransitionError,
  ValidationError,
} from '@agentforge/contract';
import type { Db } from '@agentforge/db';
import { complete, maxToolCalls, runToolLoop, type PromptSection } from '@agentforge/llm';
import {
  buildContextBundle,
  findArtifactByIdempotencyKey,
  newCorrelationId,
  requireSpecById,
  replaceEvidence,
  runLogger,
  transition,
  writeArtifact,
  type Actor,
} from '@agentforge/orchestrator';
import { skillInstructions } from '@agentforge/skills';
import { indexRepository, buildIndexEntries } from './fts.ts';
import { renderModuleSummaries, summariseModules, type ModuleSummary } from './modules.ts';
import { createRepoRoot } from './paths.ts';
import { buildRepoMap, renderRepoMap } from './repomap.ts';
import { scanRepository } from './scan.ts';
import { CONTEXT_TOOLS, executeContextTool, type ToolContext } from './tools.ts';
import { verifyClaims } from './verifier.ts';

/**
 * The Context Agent: stages 0 to 3 of the brownfield path.
 *
 * - **Stage 0** (deterministic, free): inventory, manifests, tree-sitter repo map, FTS5 index.
 * - **Stage 1**: one cached summary per module, so the loop starts oriented.
 * - **Stage 2**: the budgeted agentic loop — the model searches the repository itself.
 * - **Stage 3** (deterministic): every claim is verified against the real files.
 *
 * Stage 2 is deliberately two model calls rather than one, because **structured outputs
 * and tool use cannot be combined**: the loop explores with tools and no schema, and a
 * second call turns what it found into a schema-valid proposal. That split is also why
 * the agent cannot smuggle an unverifiable claim through — the proposal call is
 * schema-constrained, and stage 3 then checks every citation against the filesystem
 * with code that has no model in it.
 *
 * The agent proposes; it does not transition. The orchestrator performs
 * `CONTEXT_SCANNING → CONTEXT_READY` on its own behalf once the artifact exists.
 */

const AGENT: Actor = { id: 'context-agent', type: 'agent' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

/**
 * Which retrieval tools the loop is given.
 *
 * Re-exported from the contract rather than spelled again, so the ablation arms the HTTP
 * layer accepts and the arms this code implements cannot drift apart.
 */
export const RETRIEVAL_STRATEGIES = RETRIEVAL_STRATEGY_NAMES;

export type RetrievalStrategy = RetrievalStrategyName;

export interface ScanContextInput {
  readonly specId: string;
  readonly idempotencyKey: string;
  /** Defaults to the full strategy. The eval harness sets this per arm. */
  readonly strategy?: RetrievalStrategy;
  /** Overrides the environment default, clamped to the hard ceiling. */
  readonly maxToolCalls?: number;
  readonly correlationId?: string;
  /** Skips stage 1, for an eval arm that measures retrieval alone. */
  readonly skipModuleSummaries?: boolean;
  readonly onToolCall?: (invocation: { name: string; index: number }) => void;
}

export interface ScanContextResult {
  readonly bundle: ContextBundle;
  readonly costUsd: number;
  readonly replayed: boolean;
  readonly toolCallsUsed: number;
  readonly budgetExhausted: boolean;
  readonly moduleSummaries: readonly ModuleSummary[];
}

/** The tools each strategy exposes, so an ablation is a real difference in capability. */
function toolsFor(strategy: RetrievalStrategy): readonly (typeof CONTEXT_TOOLS)[number][] {
  const byName = new Map(CONTEXT_TOOLS.map((tool) => [tool.name, tool]));
  const pick = (names: readonly string[]) =>
    names.map((name) => {
      const tool = byName.get(name);
      if (tool === undefined) throw new ValidationError(`no context tool named "${name}"`);
      return tool;
    });

  switch (strategy) {
    // The baseline: what an agent with a shell already has.
    case 'grep':
      return pick(['grep', 'read_file', 'list_dir']);
    case 'repomap':
      return pick(['repo_map', 'grep', 'read_file', 'list_dir']);
    case 'fts_repomap':
      return pick(['repo_map', 'fts_search', 'grep', 'read_file', 'list_dir']);
    case 'fts_repomap_embed':
      // The contract names this arm because the plan listed it as an optional fourth
      // ablation. No embedding index is built, and silently serving the fts_repomap
      // tools under this name would put a fabricated arm in the results table.
      throw new ValidationError(
        'the fts_repomap_embed arm is not implemented: no embedding index is built, and ' +
          'running it as fts_repomap would report an arm that was never measured',
        { strategy },
      );
  }
}

export async function scanContext(db: Db, input: ScanContextInput): Promise<ScanContextResult> {
  const strategy = input.strategy ?? 'fts_repomap';
  const correlationId = input.correlationId ?? newCorrelationId();

  // Replay first, before any guard. A client that timed out and retried must get back
  // the artifact the first attempt produced, not a precondition failure on work that
  // actually completed — and a scan is the most expensive thing here to repeat.
  const replay = findArtifactByIdempotencyKey(db, input.specId, 'context', input.idempotencyKey);
  if (replay !== undefined) {
    const bundle = JSON.parse(replay.contentJson) as ContextBundle;
    return {
      bundle,
      costUsd: 0,
      replayed: true,
      toolCallsUsed: bundle.stats.tool_calls_used,
      budgetExhausted: false,
      moduleSummaries: [],
    };
  }

  const spec = requireSpecById(db, input.specId);
  const log = runLogger(correlationId, {
    spec_id: spec.id,
    stage: 'context_loop',
    strategy,
  });

  if (spec.status !== 'CONTEXT_SCANNING') {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      `a context scan may only run in CONTEXT_SCANNING, not ${spec.status}`,
      { spec_id: spec.id, status: spec.status },
    );
  }
  if (spec.mode !== 'brownfield' || spec.repoPath === null) {
    throw new TransitionError(
      'PRECONDITION_FAILED',
      'a context scan needs a brownfield spec with a repository path',
      { spec_id: spec.id, mode: spec.mode },
    );
  }

  // --- Stage 0: deterministic, free -------------------------------------
  const root = createRepoRoot(spec.repoPath);
  const scan = scanRepository(root);

  // The feature request personalises the ranking: without it the map is identical for
  // every request against this repository and much less useful.
  const focus = `${spec.title} ${spec.description}`
    .split(/[^A-Za-z0-9_]+/)
    .filter((term) => term.length >= 4)
    .slice(0, 10);

  const repoMap = await buildRepoMap(root, scan.files, { focus });
  const indexed = indexRepository(
    db,
    spec.id,
    buildIndexEntries(root, scan.files, repoMap.definitions),
  );

  log.info(
    {
      files: scan.stats.fileCount,
      used_git: scan.stats.usedGit,
      definitions: repoMap.stats.definitionCount,
      indexed,
    },
    'stage 0 complete',
  );

  // --- Stage 1: cached module summaries ---------------------------------
  let moduleSummaries: readonly ModuleSummary[] = [];
  let costUsd = 0;

  if (input.skipModuleSummaries !== true) {
    const stage1 = await summariseModules(db, {
      specId: spec.id,
      root,
      files: scan.files,
      correlationId,
    });
    moduleSummaries = stage1.summaries;
    costUsd += stage1.costUsd;
  }

  // --- Stage 2: the budgeted agentic loop -------------------------------
  //
  // Prompt order is the caching strategy and is fixed: skill, repo map, module
  // summaries. All three are stable for this repository, so the prefix is re-used across
  // the loop's turns, which is where caching actually pays here.
  const stableSections: PromptSection[] = [
    { name: 'skill:sdd-context', text: skillInstructions('sdd-context'), stable: true },
  ];

  if (strategy !== 'grep') {
    stableSections.push({
      name: 'repo-map',
      text: renderRepoMap(repoMap),
      stable: true,
    });
  }

  const rendered = renderModuleSummaries(moduleSummaries);
  if (rendered.length > 0) {
    stableSections.push({ name: 'module-summaries', text: rendered, stable: true });
  }

  const toolContext: ToolContext = {
    root,
    db,
    specId: spec.id,
    files: scan.files,
    repoMap,
  };

  // The request may lower the budget but never raise it past the server's own ceiling.
  const ceiling = maxToolCalls();
  const budget = input.maxToolCalls === undefined ? ceiling : Math.min(input.maxToolCalls, ceiling);
  const loop = await runToolLoop({
    db,
    specId: spec.id,
    stage: 'context_loop',
    correlationId,
    sections: stableSections,
    tools: toolsFor(strategy),
    maxToolCalls: budget,
    ...(input.onToolCall === undefined ? {} : { onToolCall: input.onToolCall }),
    execute: (invocation) => executeContextTool(toolContext, invocation.name, invocation.input),
    userMessage:
      'Find the code this feature touches in the repository you can search.\n\n' +
      `<feature-request>\n${spec.title}\n\n${spec.description}\n</feature-request>\n\n` +
      `You have ${String(budget)} tool calls. Search, read the ranges you intend to ` +
      'cite, and then stop and describe what you found. Do not cite a range you have ' +
      'not read.',
  });

  costUsd += loop.costUsd;
  log.info(
    { tool_calls: loop.toolCallsUsed, exhausted: loop.budgetExhausted },
    'stage 2 exploration complete',
  );

  // The proposal call. Separate because a request carrying both tools and a schema is
  // rejected, and useful because this half is schema-guaranteed: the model can no
  // longer wander, only fill in the contract.
  const transcriptDigest = loop.transcript
    .map(
      (entry, i) =>
        `[${String(i + 1)}] ${entry.name}(${JSON.stringify(entry.input)})\n${entry.result}`,
    )
    .join('\n\n');

  const { output: proposal, costUsd: proposalCost } = await complete({
    db,
    specId: spec.id,
    stage: 'context_scan',
    correlationId,
    schema: ContextProposalSchema,
    schemaName: 'context_proposal',
    sections: stableSections,
    userMessage:
      'Below is your own exploration of the repository. Turn it into the context ' +
      'proposal.\n\n' +
      'Every claim must cite a file and an inclusive line range you actually read ' +
      'above, and the symbol must literally appear inside that range. Each citation is ' +
      'verified against the real file after you answer, and failures are reported as ' +
      "this spec's unverified-claim rate.\n\n" +
      `<feature-request>\n${spec.title}\n\n${spec.description}\n</feature-request>\n\n` +
      `<your-findings>\n${loop.summary}\n</your-findings>\n\n` +
      `<exploration-transcript>\n${transcriptDigest}\n</exploration-transcript>`,
  });

  costUsd += proposalCost;

  // --- Stage 3: deterministic verification ------------------------------
  //
  // This is the claim the whole project rests on, so it is plain code: it reads the
  // files, checks the ranges and looks for the symbol. There is no model in this step
  // and nothing here can be argued out of a verdict.
  const verification = verifyClaims(root, proposal.claims);

  const evidence = replaceEvidence(
    db,
    spec.id,
    verification.claims.map((result) => ({
      file: result.claim.file,
      lineStart: result.claim.line_start,
      lineEnd: result.claim.line_end,
      symbol: result.claim.symbol,
      claim: result.claim.claim,
      relevance: result.claim.relevance,
      verified: result.verified,
      failureReason: result.failureReason,
    })),
  );

  log.info(
    {
      total: verification.total,
      verified: verification.verified,
      unverified: verification.unverified,
      unverified_claim_rate: verification.unverifiedClaimRate,
      failures: verification.failureCounts,
    },
    'stage 3 verification complete',
  );

  const bundle = buildContextBundle(db, spec.id, {
    summary: proposal.summary,
    touchedModules: proposal.touched_modules,
    openQuestions: proposal.open_questions,
    toolCallsUsed: loop.toolCallsUsed,
    retrievalStrategy: strategy,
  });

  const { artifact, replayed } = writeArtifact(db, {
    specId: spec.id,
    kind: 'context',
    payload: bundle,
    contentMd: renderContext(spec.title, bundle, evidence.length),
    actor: AGENT,
    idempotencyKey: input.idempotencyKey,
    correlationId,
  });

  // The agent wrote the artifact; the orchestrator moves the spec. Keeping these two
  // actors distinct is what lets the audit log prove no agent advanced its own work.
  const current = requireSpecById(db, spec.id);
  if (current.status === 'CONTEXT_SCANNING') {
    transition(db, {
      specId: spec.id,
      from: 'CONTEXT_SCANNING',
      to: 'CONTEXT_READY',
      actor: ORCHESTRATOR,
      expectedVersion: current.version,
      correlationId,
      payload: {
        artifact_version: artifact.version,
        unverified_claim_rate: bundle.stats.unverified_claim_rate,
        tool_calls_used: loop.toolCallsUsed,
        retrieval_strategy: strategy,
      },
    });
  }

  return {
    bundle,
    costUsd,
    replayed,
    toolCallsUsed: loop.toolCallsUsed,
    budgetExhausted: loop.budgetExhausted,
    moduleSummaries,
  };
}

/**
 * Renders `context.md`.
 *
 * Pure and clock-free, like every other renderer here: a document that varied between
 * renders would change its own content hash and silently invalidate an approval.
 */
export function renderContext(title: string, bundle: ContextBundle, evidenceCount: number): string {
  const lines: string[] = [`# Context: ${title}`, '', bundle.summary, ''];

  const stats = bundle.stats;
  lines.push(
    '## Grounding',
    '',
    `- claims: ${String(stats.total_claims)}`,
    `- verified: ${String(stats.verified_claims)}`,
    `- unverified: ${String(stats.unverified_claims)}`,
    `- unverified-claim rate: ${(stats.unverified_claim_rate * 100).toFixed(1)}%`,
    `- tool calls used: ${String(stats.tool_calls_used)}`,
    `- retrieval strategy: ${stats.retrieval_strategy}`,
    '',
  );

  if (bundle.touched_modules.length > 0) {
    lines.push('## Modules touched', '');
    for (const module of bundle.touched_modules) lines.push(`- ${module}`);
    lines.push('');
  }

  lines.push('## Evidence', '');
  if (evidenceCount === 0) {
    lines.push('No evidence was produced.', '');
  } else {
    for (const item of bundle.evidence) {
      const range = `${item.file}:${String(item.line_start)}-${String(item.line_end)}`;
      const mark = item.verified ? 'verified' : `UNVERIFIED (${item.failure_reason ?? 'unknown'})`;
      lines.push(`### ${item.id} — ${range} [${mark}]`, '');
      if (item.symbol !== null) lines.push(`**Symbol:** \`${item.symbol}\``, '');
      lines.push(item.claim, '', `*Relevance:* ${item.relevance}`, '');
    }
  }

  if (bundle.open_questions.length > 0) {
    lines.push('## Open questions', '');
    for (const question of bundle.open_questions) lines.push(`- ${question}`);
    lines.push('');
  }

  return lines.join('\n');
}
