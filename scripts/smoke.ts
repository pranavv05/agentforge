/**
 * Live smoke test: run the greenfield pipeline against the real API.
 *
 *   npm run sdd:smoke
 *   SDD_CASSETTE_MODE=record npm run sdd:smoke    # also capture fixtures
 *
 * Drives one spec from CREATED to DESIGN_AWAITING_APPROVAL through the real gates, with
 * real model calls, then prints the measured cost from `llm_calls`. This is the only
 * thing that can tell us whether the prompts actually produce usable requirements and a
 * grounded design — every other test stubs the transport.
 *
 * It uses a throwaway database so a smoke run never touches the development fixtures.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, schema } from '@agentforge/db';
import { draftDesign, draftRequirements } from '@agentforge/agents';
import { loadEnvFile, resolveProvider } from '@agentforge/llm';
import {
  createSpec,
  decideArtifact,
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

const provider = resolveProvider();
console.log(`# Live smoke test\n`);
console.log(`- gateway: ${provider.name}`);
console.log(`- requirements model: ${process.env['SDD_MODEL_REQUIREMENTS'] ?? 'claude-haiku-5-5'}`);
console.log(`- design model: ${process.env['SDD_MODEL_DESIGN'] ?? 'claude-haiku-5-5'}`);
console.log(`- cassette mode: ${process.env['SDD_CASSETTE_MODE'] ?? 'off'}\n`);

const dir = mkdtempSync(join(tmpdir(), 'agentforge-smoke-'));
const db = createDb(join(dir, 'smoke.db'));

const current = (specId: string) => {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec;
};

try {
  // --- Create and start drafting ----------------------------------------
  const spec = createSpec(db, {
    title: 'GST-compliant invoice export',
    description:
      'Humein chahiye ki ek finalised invoice ko GST e-invoice JSON format mein export kiya ' +
      'ja sake, taaki use IRP par upload kiya ja sake. The export must refuse to produce a ' +
      'payload when a mandatory field is missing, and every invoice number must be part of a ' +
      'gap-free series within the financial year.',
    mode: 'greenfield',
    repo_path: null,
    actor: HUMAN,
  });

  console.log(`spec ${spec.id} created\n`);

  transition(db, {
    specId: spec.id,
    from: 'CREATED',
    to: 'REQ_DRAFTING',
    actor: ORCHESTRATOR,
    expectedVersion: spec.version,
  });

  // --- Requirements -----------------------------------------------------
  console.log('## Requirement Agent\n');
  let requirements = await draftRequirements(db, {
    specId: spec.id,
    idempotencyKey: 'smoke-requirements-1',
  });

  // The agent may ask before it proposes. Answer with the first suggested option so the
  // smoke run exercises the clarification loop end to end rather than skipping it.
  if (requirements.outcome === 'clarification_requested') {
    console.log(`asked ${String(requirements.clarifications.length)} question(s):`);
    for (const question of requirements.clarifications) {
      console.log(`  - ${question.question}`);
      console.log(`    why: ${question.why_it_matters}`);
    }

    const { answerClarifications } = await import('@agentforge/orchestrator');
    answerClarifications(
      db,
      spec.id,
      requirements.clarifications.map((question) => ({
        clarificationId: question.id,
        answer:
          question.options[0] ?? 'Use your judgement and state the assumption in the rationale.',
      })),
      HUMAN,
    );
    console.log('\nanswered; redrafting\n');

    transition(db, {
      specId: spec.id,
      from: 'REQ_AWAITING_CLARIFICATION',
      to: 'REQ_DRAFTING',
      actor: HUMAN,
      expectedVersion: current(spec.id).version,
    });

    requirements = await draftRequirements(db, {
      specId: spec.id,
      idempotencyKey: 'smoke-requirements-2',
    });
  }

  if (requirements.outcome !== 'proposed') {
    throw new Error('the Requirement Agent never proposed requirements');
  }

  console.log(`proposed ${String(requirements.proposal.requirements.length)} requirement(s):`);
  for (const req of requirements.proposal.requirements) {
    console.log(`  ${req.id} [${req.ears_pattern}, ${req.priority}] ${req.ears_statement}`);
    for (const criterion of req.acceptance_criteria) {
      console.log(
        `    ${criterion.id}: given ${criterion.given}, when ${criterion.when}, then ${criterion.then}` +
          (criterion.compliance_rule_key === null ? '' : ` [${criterion.compliance_rule_key}]`),
      );
    }
  }
  if (requirements.proposal.non_goals.length > 0) {
    console.log(`  non-goals: ${requirements.proposal.non_goals.join('; ')}`);
  }

  // --- Human approval ---------------------------------------------------
  const reqHead = getHeadArtifact(db, spec.id, 'requirements');
  if (reqHead === undefined) throw new Error('no requirements artifact');

  decideArtifact(db, {
    specId: spec.id,
    kind: 'requirements',
    contentHash: reqHead.contentHash,
    decision: 'approve',
    comment: 'Approved by the smoke run.',
    actor: HUMAN,
    expectedVersion: current(spec.id).version,
  });
  console.log(
    `\nrequirements v${String(reqHead.version)} approved at ${reqHead.contentHash.slice(0, 12)}\n`,
  );

  transition(db, {
    specId: spec.id,
    from: 'REQ_APPROVED',
    to: 'DESIGN_DRAFTING',
    actor: ORCHESTRATOR,
    expectedVersion: current(spec.id).version,
  });

  // --- Design -----------------------------------------------------------
  console.log('## Design Agent\n');
  const design = await draftDesign(db, {
    specId: spec.id,
    idempotencyKey: 'smoke-design-1',
  });

  console.log(`proposed ${String(design.proposal.sections.length)} section(s):`);
  for (const section of design.proposal.sections) {
    console.log(`  ${section.id} ${section.heading} -> ${section.requirement_ids.join(', ')}`);
  }
  for (const decision of design.proposal.decisions) {
    console.log(`  ${decision.id} ${decision.decision}`);
  }
  for (const risk of design.proposal.risks) {
    console.log(`  risk: ${risk}`);
  }

  // --- Result -----------------------------------------------------------
  console.log(`\n## Outcome\n`);
  console.log(`- final state: ${current(spec.id).status}`);
  console.log(
    `- audit trail: ${listAuditEntries(db, spec.id)
      .map((e) => e.toState)
      .join(' -> ')}`,
  );

  const cost = getCostSummary(db, spec.id);
  const rows = db
    .select({
      stage: schema.llmCalls.stage,
      model: schema.llmCalls.model,
      input: schema.llmCalls.inputTokens,
      output: schema.llmCalls.outputTokens,
      cacheRead: schema.llmCalls.cacheReadInputTokens,
      cacheWrite: schema.llmCalls.cacheCreationInputTokens,
      costUsd: schema.llmCalls.costUsd,
      costSource: schema.llmCalls.costSource,
      latencyMs: schema.llmCalls.latencyMs,
    })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.specId, spec.id))
    .all();

  console.log(`\n### Measured cost\n`);
  for (const row of rows) {
    console.log(
      `- ${row.stage}: in ${String(row.input)}, out ${String(row.output)}, ` +
        `cache r/w ${String(row.cacheRead)}/${String(row.cacheWrite)}, ` +
        `$${row.costUsd.toFixed(6)} (${row.costSource}), ${String(row.latencyMs)}ms`,
    );
  }
  console.log(
    `\n- total: $${cost.total_cost_usd.toFixed(6)} across ${String(cost.call_count)} call(s)`,
  );
  console.log(`- cache hit rate: ${(cost.cache_hit_rate * 100).toFixed(1)}%`);

  // --- Is the computed cost actually right? -----------------------------
  //
  // Streamed calls carry no gateway cost figure: the SDK rebuilds usage from the stream
  // deltas and drops OpenRouter's non-standard `cost` field, and the Anthropic-format
  // message id is not a valid OpenRouter generation id, so it cannot be fetched
  // afterwards either. The recorded cost is therefore computed from the list-price table.
  //
  // That is only honest if the gateway really passes list pricing through. One small
  // non-streaming call settles it, because non-streaming responses *do* carry `cost` —
  // and re-checking on every smoke run means the report's cost figures rest on a
  // measurement rather than an assumption.
  if (provider.name === 'openrouter') {
    const { anthropic } = await import('@agentforge/llm');
    const { computeCost } = await import('@agentforge/orchestrator');

    const probe = await anthropic().messages.create({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });

    const reported = (probe.usage as unknown as { cost?: number }).cost ?? null;
    const computed = computeCost('claude-haiku-5-5', {
      inputTokens: probe.usage.input_tokens,
      outputTokens: probe.usage.output_tokens,
      cacheReadInputTokens: probe.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: probe.usage.cache_creation_input_tokens ?? 0,
    });

    console.log('\n### Cost model check\n');
    if (reported === null) {
      console.log('- the gateway reported no cost; the computed figure stands unverified');
    } else {
      const drift = Math.abs(reported - computed) / Math.max(reported, 1e-12);
      console.log(`- gateway reported:  $${reported.toFixed(9)}`);
      console.log(`- our table computed: $${computed.toFixed(9)}`);
      console.log(`- relative difference: ${(drift * 100).toFixed(2)}%`);
      console.log(
        drift < 0.02
          ? '- the gateway passes list pricing through, so computed figures are accurate'
          : '- MISMATCH: the gateway does not use list pricing, so MODEL_PRICING needs a ' +
              'provider-specific table before any cost figure is quoted',
      );
    }
  }

  console.log(`\n### Rendered requirements.md (first 30 lines)\n`);
  console.log(
    reqHead.contentMd
      .split('\n')
      .slice(0, 30)
      .map((line) => `  ${line}`)
      .join('\n'),
  );
} finally {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
}
