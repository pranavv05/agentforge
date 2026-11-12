/**
 * Live smoke test: the Task Agent and the compliance trace, against a real model.
 *
 *   npm run sdd:smoke:tasks
 *
 * `sdd:smoke` stops at DESIGN_AWAITING_APPROVAL, so two things had only ever run against a
 * stub: the Task Agent, and the rule -> requirement -> design -> task trace that depends on
 * its output. A stub satisfies every deterministic check by construction. A real model has
 * to *earn* them, and the Task Agent's validation is strict — an unknown requirement id, a
 * dependency cycle, a task citing a criterion that does not exist, or any acceptance
 * criterion left unverified is a thrown error, not a warning. Whether the live model
 * clears that bar is the thing this run measures.
 *
 * It also tests the compliance pack against a model that has been handed a trap. The
 * request below cites Section 194J, which the Income-tax Act 2025 dissolved into Section
 * 393. The pack injects that fact into the prompt; this checks whether the model acts on
 * it, or repeats the dead section anyway.
 *
 * Runs on Sonnet 5.5 by default — the demo-quality model, so the output is what would be
 * shown in a defence. Override with SDD_MODEL_REQUIREMENTS / SDD_MODEL_DESIGN /
 * SDD_MODEL_TASKS.
 *
 * Isolated: it uses a throwaway database, so nothing here touches the development data,
 * and every approval is recorded under a plainly named test reviewer rather than any real
 * account. It writes no code.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, schema } from '@agentforge/db';
import {
  DesignProposalSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
} from '@agentforge/contract';
import { parseJsonColumn } from '@agentforge/db';
import { draftDesign, draftRequirements, generateTasks } from '@agentforge/agents';
import {
  applicableRules,
  buildTraceMatrix,
  detectSupersededTerms,
  installedPackVersion,
  untracedRules,
  unscheduledRules,
} from '@agentforge/compliance';
import { loadEnvFile, resolveProvider } from '@agentforge/llm';
import {
  answerClarifications,
  createSpec,
  decideArtifact,
  getCostSummary,
  getHeadArtifact,
  getSpec,
  listAuditEntries,
  listTasks,
  transition,
  type Actor,
} from '@agentforge/orchestrator';
import { eq } from 'drizzle-orm';

loadEnvFile();

// Sonnet, set unconditionally. This used to use `??=`, which is wrong here: the
// development .env pins Haiku for these stages, `loadEnvFile()` had already loaded it, and
// so the "Sonnet" run silently ran on Haiku. A smoke run that says one model and uses
// another is worse than none. Choose a different one with SDD_SMOKE_MODEL.
const MODEL = process.env['SDD_SMOKE_MODEL'] ?? 'claude-sonnet-5-5';
for (const name of ['SDD_MODEL_REQUIREMENTS', 'SDD_MODEL_DESIGN', 'SDD_MODEL_TASKS']) {
  process.env[name] = MODEL;
}
// A ceiling for this script, also set unconditionally, so a misbehaving prompt cannot spend
// without limit regardless of what the development .env allows.
process.env['SDD_RUN_COST_CAP_USD'] = process.env['SDD_SMOKE_CAP_USD'] ?? '1.50';

/** A test identity. Approvals in a scratch database are not anyone's decision. */
/**
 * Two requests for the same feature.
 *
 * `clean` is what a person would normally write. `trap` also says the team currently uses
 * Section 194J, which the Income-tax Act 2025 dissolved into Section 393, to find out
 * whether the live model acts on the compliance pack or repeats the dead section.
 *
 * The trap earned its place. Run live, the model produced a *correct* design — a validator
 * that rejects 194-series citations and names Section 393 as the equivalent of 194J — and
 * the compliance guard refused it anyway, because the guard matches the text "Section 194J"
 * wherever it appears and cannot tell citing it as law from naming it as the thing being
 * rejected. That is a false positive on the most natural legacy-migration feature there is.
 * It is recorded here as a finding, not worked around: the `clean` scenario is how the Task
 * Agent gets exercised, and the policy question about the guard is a separate decision.
 */
const SCENARIOS = {
  clean:
    'When we pay a vendor for professional services we deduct TDS. Show the amount deducted ' +
    'and the payment code on the payment advice, and refuse to release the payment if the ' +
    'vendor has no PAN on record.',
  trap:
    'When we pay a vendor for professional services we currently deduct TDS under Section ' +
    '194J. Show the amount deducted and the payment code on the payment advice, and refuse ' +
    'to release the payment if the vendor has no PAN on record.',
} as const;

const scenario = (process.env['SDD_SMOKE_SCENARIO'] ?? 'clean') as keyof typeof SCENARIOS;
if (!(scenario in SCENARIOS)) {
  throw new Error(`SDD_SMOKE_SCENARIO must be "clean" or "trap", received "${scenario}"`);
}

const REVIEWER: Actor = { id: 'smoke-tasks-test-reviewer@agentforge.local', type: 'human' };
const ORCHESTRATOR: Actor = { id: 'orchestrator', type: 'orchestrator' };

const provider = resolveProvider();
console.log('# Live smoke test: Task Agent and compliance trace\n');
console.log(`- gateway: ${provider.name}`);
console.log(`- requirements model: ${process.env['SDD_MODEL_REQUIREMENTS'] ?? '?'}`);
console.log(`- design model: ${process.env['SDD_MODEL_DESIGN'] ?? '?'}`);
console.log(`- tasks model: ${process.env['SDD_MODEL_TASKS'] ?? '?'}`);
console.log(`- spend ceiling: ${process.env['SDD_RUN_COST_CAP_USD'] ?? '?'}`);
console.log(`- scenario: ${scenario}\n`);

/**
 * SDD_SMOKE_REPLAY=1 replays the requirements and design from recordings of an earlier live
 * run, and goes live only for the Task Agent.
 *
 * Cassette modes are all-or-nothing, but the mode is read per call, so switching it between
 * stages is enough. It exists because the stages before the Task Agent are expensive on
 * Sonnet and were already recorded from a live run; replaying them costs nothing and lets a
 * fix to a *later* stage be tested against the exact output that previously failed it. The
 * output says which stages replayed, so a replayed stage is never presented as a live one.
 */
const replayEarly = process.env['SDD_SMOKE_REPLAY'] === '1';
if (replayEarly) process.env['SDD_CASSETTE_MODE'] = 'replay';
console.log(
  `- requirements and design: ${replayEarly ? 'REPLAYED from earlier live recordings' : 'live'}`,
);
console.log('- task agent: live\n');

const dir = mkdtempSync(join(tmpdir(), 'agentforge-smoke-tasks-'));
const db = createDb(join(dir, 'smoke-tasks.db'));

const current = (specId: string) => {
  const spec = getSpec(db, specId);
  if (spec === undefined) throw new Error('spec vanished');
  return spec;
};

/** The head artifact's content hash, which an approval must bind to. */
function head(specId: string, kind: 'requirements' | 'design' | 'tasks') {
  const artifact = getHeadArtifact(db, specId, kind);
  if (artifact === undefined) throw new Error(`no ${kind} artifact`);
  return artifact;
}

function approve(specId: string, kind: 'requirements' | 'design'): void {
  const artifact = head(specId, kind);
  decideArtifact(db, {
    specId,
    kind,
    contentHash: artifact.contentHash,
    decision: 'approve',
    comment: 'Approved by the smoke run, as a test reviewer. Not a real decision.',
    actor: REVIEWER,
    expectedVersion: current(specId).version,
  });
  console.log(
    `${kind} v${String(artifact.version)} approved at ${artifact.contentHash.slice(0, 12)}`,
  );
}

async function run(): Promise<void> {
  try {
    const spec = createSpec(db, {
      title: 'Deduct TDS when paying a vendor',
      description: SCENARIOS[scenario],
      mode: 'greenfield',
      repo_path: null,
      actor: REVIEWER,
    });
    console.log(`spec ${spec.id} created\n`);

    transition(db, {
      specId: spec.id,
      from: 'CREATED',
      to: 'REQ_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: spec.version,
    });

    // --- Requirements --------------------------------------------------------------------
    console.log('## Requirement Agent\n');
    let requirements = await draftRequirements(db, {
      specId: spec.id,
      idempotencyKey: 'smoke-tasks-requirements-1',
    });

    if (requirements.outcome === 'clarification_requested') {
      console.log(`asked ${String(requirements.clarifications.length)} question(s):`);
      for (const question of requirements.clarifications) console.log(`  - ${question.question}`);

      answerClarifications(
        db,
        spec.id,
        requirements.clarifications.map((question) => ({
          clarificationId: question.id,
          answer: question.options[0] ?? 'Use your judgement and state the assumption.',
        })),
        REVIEWER,
      );

      transition(db, {
        specId: spec.id,
        from: 'REQ_AWAITING_CLARIFICATION',
        to: 'REQ_DRAFTING',
        actor: REVIEWER,
        expectedVersion: current(spec.id).version,
      });

      requirements = await draftRequirements(db, {
        specId: spec.id,
        idempotencyKey: 'smoke-tasks-requirements-2',
      });
    }

    if (requirements.outcome !== 'proposed') {
      throw new Error('the Requirement Agent never proposed requirements');
    }

    const reqCount = requirements.proposal.requirements.length;
    const criteriaCount = requirements.proposal.requirements.reduce(
      (n, r) => n + r.acceptance_criteria.length,
      0,
    );
    const complianceCriteria = requirements.proposal.requirements.flatMap((r) =>
      r.acceptance_criteria.filter((c) => c.compliance_rule_key !== null),
    );
    console.log(
      `proposed ${String(reqCount)} requirements, ${String(criteriaCount)} criteria, ` +
        `${String(complianceCriteria.length)} carrying a compliance rule key`,
    );
    approve(spec.id, 'requirements');

    transition(db, {
      specId: spec.id,
      from: 'REQ_APPROVED',
      to: 'DESIGN_DRAFTING',
      actor: ORCHESTRATOR,
      expectedVersion: current(spec.id).version,
    });

    // --- Design --------------------------------------------------------------------------
    console.log('\n## Design Agent\n');
    try {
      const design = await draftDesign(db, {
        specId: spec.id,
        idempotencyKey: 'smoke-tasks-design-1',
      });
      console.log(`proposed ${String(design.proposal.sections.length)} sections`);
    } catch (error) {
      // A refusal is a result. It means the live model produced something the deterministic
      // guard would not let into a document — which is what this run exists to find out.
      const e = error as { code?: string; message?: string; details?: unknown };
      console.log("outcome: REFUSED by the Design Agent's own validation");
      console.log(`  code: ${e.code ?? 'unknown'}`);
      console.log(`  message: ${(e.message ?? 'no message').slice(0, 400)}`);
      console.log(`  details: ${JSON.stringify(e.details ?? null).slice(0, 700)}`);
      const spent = getCostSummary(db, spec.id);
      console.log(`\n- state: ${current(spec.id).status}`);
      console.log(
        `- spent before refusal: ${spent.total_cost_usd.toFixed(6)} across ${String(spent.call_count)} call(s)`,
      );
      process.exitCode = 2;
      return;
    }
    approve(spec.id, 'design');

    // --- Tasks: the part that had never run live -----------------------------------------
    console.log('\n## Task Agent\n');
    // Live from here, and recorded, whatever the earlier stages did.
    if (replayEarly) process.env['SDD_CASSETTE_MODE'] = 'record';
    let outcome = 'generated';
    let taskError: unknown = null;
    let tasksResult: Awaited<ReturnType<typeof generateTasks>> | null = null;

    try {
      tasksResult = await generateTasks(db, {
        specId: spec.id,
        idempotencyKey: 'smoke-tasks-tasks-1',
      });
    } catch (error) {
      outcome = "REFUSED by the Task Agent's own validation";
      taskError = error;
    }

    console.log(`outcome: ${outcome}`);

    if (taskError !== null) {
      // A refusal is a result, not a crash: it says the live model produced something the
      // deterministic checks would not accept, which is exactly what this run exists to find.
      const e = taskError as { code?: string; message?: string; details?: unknown };
      console.log(`  code: ${e.code ?? 'unknown'}`);
      console.log(`  message: ${e.message ?? 'no message'}`);
      console.log(`  details: ${JSON.stringify(e.details ?? null).slice(0, 600)}`);
    }

    if (tasksResult !== null) {
      const proposal = tasksResult.proposal;
      console.log(
        `proposed ${String(proposal.tasks.length)} tasks; ${String(tasksResult.tasksInserted)} rows inserted`,
      );
      console.log(`state: ${current(spec.id).status}\n`);

      for (const task of proposal.tasks) {
        console.log(
          `  ${task.id}  ${task.title}\n` +
            `     implements ${task.requirement_ids.join(', ') || '-'} | ` +
            `design ${task.design_section_ids.join(', ') || '-'} | ` +
            `verifies ${task.verifies.join(', ') || '-'} | ` +
            `depends on ${task.depends_on.join(', ') || '-'}`,
        );
      }

      console.log(`\nimplementation order: ${proposal.implementation_order_rationale}`);

      // --- The trace matrix: rule -> requirement -> design -> task -------------------------
      console.log('\n## Compliance trace\n');

      const reqProposal = parseJsonColumn(
        RequirementsProposalSchema,
        head(spec.id, 'requirements').contentJson,
        'requirements',
      );
      const designProposal = parseJsonColumn(
        DesignProposalSchema,
        head(spec.id, 'design').contentJson,
        'design',
      );
      const tasksProposal = parseJsonColumn(
        TasksProposalSchema,
        head(spec.id, 'tasks').contentJson,
        'tasks',
      );

      const rules = applicableRules({
        title: spec.title,
        description: spec.description,
        requirementText: reqProposal.requirements.map((r) => `${r.ears_statement} ${r.rationale}`),
      });

      // The same text the trace route scans, so this reports what the product would report.
      const violations = detectSupersededTerms([
        { location: 'design.overview', text: designProposal.overview },
        ...designProposal.sections.map((section, i) => ({
          location: `design.sections[${String(i)}].body`,
          text: section.body,
        })),
        ...reqProposal.requirements.map((req, i) => ({
          location: `requirements[${String(i)}].rationale`,
          text: req.rationale,
        })),
      ]);

      const coverage = buildTraceMatrix({
        packVersion: installedPackVersion(db) ?? 'not installed',
        applicableRules: rules,
        requirements: reqProposal,
        design: designProposal,
        tasks: tasksProposal,
        violations,
      });

      console.log(`- pack version: ${coverage.pack_version}`);
      console.log(`- rules that apply to this spec: ${String(rules.length)}`);
      for (const rule of rules) console.log(`    ${rule.key}  ${rule.title}`);
      console.log(
        `- rules reaching a task (coverage): ${(coverage.coverage_rate * 100).toFixed(0)}%`,
      );
      console.log(
        `- rules written down but never designed: ${JSON.stringify(untracedRules(coverage))}`,
      );
      console.log(
        `- rules designed but never scheduled: ${JSON.stringify(unscheduledRules(coverage))}`,
      );
      console.log(
        `- superseded-term violations in the model's own output: ${String(violations.length)}`,
      );
      for (const v of violations) {
        console.log(
          `    [${v.severity}] ${v.rule_key} at ${v.location}: "${v.matched_text}" -> ${v.replacement}`,
        );
      }
      if (violations.length === 0) {
        console.log(
          '    (none: the model acted on the pack and did not repeat the dissolved section)',
        );
      }

      console.log(`\n### Rendered tasks.md\n`);
      console.log(
        head(spec.id, 'tasks')
          .contentMd.split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );

      console.log(`\nrows in tasks table: ${String(listTasks(db, spec.id).length)}`);
    }

    // --- Cost ---------------------------------------------------------------------------
    console.log('\n## Outcome\n');
    console.log(`- final state: ${current(spec.id).status}`);
    console.log(
      `- audit trail: ${listAuditEntries(db, spec.id)
        .map((e) => e.toState)
        .join(' -> ')}`,
    );
    const agentRows = listAuditEntries(db, spec.id).filter((e) => e.actorType === 'agent');
    console.log(`- transitions caused by an agent actor: ${String(agentRows.length)} (must be 0)`);

    const cost = getCostSummary(db, spec.id);
    const rows = db
      .select({
        stage: schema.llmCalls.stage,
        model: schema.llmCalls.model,
        input: schema.llmCalls.inputTokens,
        output: schema.llmCalls.outputTokens,
        cacheRead: schema.llmCalls.cacheReadInputTokens,
        costUsd: schema.llmCalls.costUsd,
        latencyMs: schema.llmCalls.latencyMs,
      })
      .from(schema.llmCalls)
      .where(eq(schema.llmCalls.specId, spec.id))
      .all();

    console.log('\n### Measured cost\n');
    for (const row of rows) {
      console.log(
        `- ${row.stage} (${row.model}): in ${String(row.input)}, out ${String(row.output)}, ` +
          `cache read ${String(row.cacheRead)}, $${row.costUsd.toFixed(6)}, ${String(row.latencyMs)}ms`,
      );
    }
    console.log(
      `\n- total: $${cost.total_cost_usd.toFixed(6)} across ${String(cost.call_count)} call(s)`,
    );
  } finally {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

await run();
