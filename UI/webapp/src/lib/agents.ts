import { sha256 } from './crypto'
import { transition, GovernanceError, WRITE_ALLOWED, type SpecRow, type Status } from './fsm'
import { retrieve, verifyClaim, buildRepoMap, FIXTURE, FIXTURE_NAME, terms, type Claim } from './fixture'
import { PACK_VERSION, triggered, LEGACY_RE, type Rule } from './compliance'

/* ---------- pricing (per MTok, from the build plan's official price table) ---------- */
export const PRICES = {
  'haiku-5.5': { label: 'Claude Haiku 5.5', in: 0.1, out: 0.5, cr: 0.01, cw: 0.125 },
  'sonnet-5.5': { label: 'Claude Sonnet 5.5', in: 2, out: 10, cr: 0.1, cw: 2.5 },
} as const
type Model = keyof typeof PRICES
type Tok = { in: number; cr: number; cw: number; out: number }

export const PROFILE: Record<string, { model: (p: 'dev' | 'demo') => Model; tok: Tok; batch?: boolean }> = {
  context: { model: () => 'haiku-5.5', tok: { in: 80000, cr: 720000, cw: 40000, out: 15000 } },
  module_summaries: { model: () => 'haiku-5.5', tok: { in: 400000, cr: 0, cw: 0, out: 40000 }, batch: true },
  questions: { model: (p) => (p === 'dev' ? 'haiku-5.5' : 'sonnet-5.5'), tok: { in: 12000, cr: 0, cw: 4000, out: 1500 } },
  requirements: { model: (p) => (p === 'dev' ? 'haiku-5.5' : 'sonnet-5.5'), tok: { in: 40000, cr: 45000, cw: 5000, out: 12000 } },
  design: { model: (p) => (p === 'dev' ? 'haiku-5.5' : 'sonnet-5.5'), tok: { in: 45000, cr: 55000, cw: 5000, out: 16000 } },
  tasks: { model: (p) => (p === 'dev' ? 'haiku-5.5' : 'sonnet-5.5'), tok: { in: 20000, cr: 15000, cw: 3000, out: 6000 } },
}

export function costOf(model: Model, t: Tok, batch = false) {
  const p = PRICES[model]
  const c = (t.in * p.in + t.cr * p.cr + t.cw * p.cw + t.out * p.out) / 1e6
  return batch ? c * 0.5 : c
}

const scaleFor = (spec: SpecRow) => 1 + Math.min(spec.description.length, 1200) / 2400

async function spent(db: D1Database, specId: string) {
  const r = await db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_calls WHERE spec_id = ?').bind(specId).first<{ s: number }>()
  return r?.s ?? 0
}

async function callLLM(db: D1Database, spec: SpecRow, stage: keyof typeof PROFILE) {
  const prof = PROFILE[stage]
  const model = prof.model(spec.profile)
  const k = scaleFor(spec)
  const tok: Tok = { in: Math.round(prof.tok.in * k), cr: Math.round(prof.tok.cr * k), cw: Math.round(prof.tok.cw * k), out: Math.round(prof.tok.out * k) }
  const cost = costOf(model, tok, prof.batch)
  const already = await spent(db, spec.id)
  if (already + cost > spec.cap_usd) {
    throw new GovernanceError('cost_cap', `Per-run cost cap of $${spec.cap_usd.toFixed(2)} would be exceeded by stage "${stage}" (spent $${already.toFixed(3)}, next call ~$${cost.toFixed(3)}). Raise the cap to continue.`, 402)
  }
  await db
    .prepare('INSERT INTO llm_calls (spec_id, stage, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, simulated) VALUES (?,?,?,?,?,?,?,?,1)')
    .bind(spec.id, prof.batch ? stage + ' (batch)' : stage, PRICES[model].label, tok.in, tok.cr, tok.cw, tok.out, cost)
    .run()
  return { cost, tok, model }
}

/* ---------- db helpers ---------- */
export async function getSpec(db: D1Database, id: string) {
  const s = await db.prepare('SELECT * FROM specs WHERE id = ?').bind(id).first<SpecRow>()
  if (!s) throw new GovernanceError('not_found', 'Spec not found', 404)
  return s
}

export async function latestArtifact(db: D1Database, specId: string, type: string) {
  return db
    .prepare('SELECT * FROM artifacts WHERE spec_id = ? AND type = ? ORDER BY version DESC LIMIT 1')
    .bind(specId, type)
    .first<{ id: number; spec_id: string; type: string; version: number; markdown: string; data: string; hash: string; author: string; created_at: string }>()
}

async function saveArtifact(db: D1Database, specId: string, type: string, markdown: string, data: unknown, author: string) {
  const prev = await latestArtifact(db, specId, type)
  const version = (prev?.version ?? 0) + 1
  const hash = await sha256(markdown)
  await db
    .prepare('INSERT INTO artifacts (spec_id, type, version, markdown, data, hash, author) VALUES (?,?,?,?,?,?,?)')
    .bind(specId, type, version, markdown, JSON.stringify(data), hash, author)
    .run()
  return { version, hash }
}

async function orch(db: D1Database, specId: string, to: Status, action: string, detail = '') {
  const s = await getSpec(db, specId)
  return transition(db, specId, to, { type: 'orchestrator', id: 'orchestrator' }, s.version, action, detail)
}

/* ---------- text helpers ---------- */
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const clean = (s: string) =>
  s.replace(/^(please\s+)?(we\s+|i\s+)?(want to|need to|would like to)?\s*(add|build|create|implement|support|make|enable|develop)\s+/i, '').replace(/[.\s]+$/, '').trim()

function fragments(desc: string, title: string): string[] {
  let parts = desc.split(/[.;\n]+/).map((s) => s.trim()).filter((s) => s.length > 8)
  if (parts.length < 2 && desc.length > 40) parts = desc.split(/,|\band\b/i).map((s) => s.trim()).filter((s) => s.length > 8)
  const out = parts.map(clean).filter(Boolean).slice(0, 4)
  return out.length ? out : [clean(title) || 'deliver the requested capability']
}

const claimRef = (c: Claim) => `\`${c.file}:L${c.line_start}-L${c.line_end}\``

/* ---------- Stage 0-3: Context Agent ---------- */
export async function runContext(db: D1Database, specId: string) {
  await orch(db, specId, 'CONTEXT_SCANNING', 'context_scan_started', `repo: ${FIXTURE_NAME}`)
  const spec = await getSpec(db, specId)
  await callLLM(db, spec, 'module_summaries')
  await callLLM(db, spec, 'context')
  const text = `${spec.title}. ${spec.description}`
  const r = retrieve(text)
  const verdicts = r.claims.map((c) => ({ ...c, verdict: verifyClaim(c) }))
  const map = buildRepoMap()
  const md = [
    `# Context bundle — ${spec.title}`,
    `> Repo: **${FIXTURE_NAME}** · ${Object.keys(FIXTURE).length} files · ${map.length} symbols indexed · tool calls ${r.toolCalls.length}/25 (cap)`,
    '',
    '## Stage 0 — deterministic scan (free, no LLM)',
    `- ripgrep-style inventory: ${Object.keys(FIXTURE).length} files`,
    `- repo map: ${map.length} definitions ranked and packed (tree-sitter stand-in)`,
    `- FTS index: path + symbol + comment tokens`,
    '',
    '## Stage 2 — budgeted agentic loop (trace)',
    ...r.toolCalls.map((t, i) => `${i + 1}. \`${t.tool}(${t.args})\` → ${t.hits} hit${t.hits === 1 ? '' : 's'}`),
    '',
    '## Stage 3 — grounding verifier',
    '| # | Claim | Evidence | Verdict |',
    '|---|---|---|---|',
    ...verdicts.map((v, i) => `| ${i + 1} | ${v.claim} | ${claimRef(v)} | ${v.verdict.ok ? 'verified' : 'unverified: ' + v.verdict.reason} |`),
    '',
    `**Candidate files:** ${r.files.map((f) => `\`${f.file}\``).join(', ') || 'none'}`,
  ].join('\n')
  await saveArtifact(db, specId, 'context', md, { claims: verdicts, files: r.files, toolCalls: r.toolCalls, symbols: map.length }, 'agent:context')
  await orch(db, specId, 'CONTEXT_READY', 'context_ready', `${verdicts.filter((v) => v.verdict.ok).length}/${verdicts.length} claims verified`)
}

/* ---------- Requirement Agent ---------- */
export async function startRequirements(db: D1Database, specId: string) {
  await orch(db, specId, 'REQ_DRAFTING', 'requirements_drafting_started')
  const spec = await getSpec(db, specId)
  await callLLM(db, spec, 'questions')
  const text = `${spec.title} ${spec.description}`
  const low = text.toLowerCase()
  const qs: string[] = ['Who are the primary users and which roles may approve changes?']
  if (/tds|vendor|contractor|professional/.test(low)) qs.push('Which payee types does this cover (individual, HUF, company) and which payment categories (contractor, professional, technical)?')
  if (/gst|invoice|e-?invoice/.test(low)) qs.push('What is the seller aggregate turnover (INR crore)? E-invoicing applicability depends on the threshold.')
  qs.push('Are there volume, latency or audit-retention constraints we must design for?')
  const md = ['# Clarifying questions', ...qs.map((q, i) => `${i + 1}. ${q}`)].join('\n')
  await saveArtifact(db, specId, 'questions', md, { questions: qs }, 'agent:requirement')
  await orch(db, specId, 'REQ_AWAITING_CLARIFICATION', 'clarification_requested', `${qs.length} questions`)
}

async function draftRequirements(db: D1Database, specId: string, revisionNote?: string) {
  const spec = await getSpec(db, specId)
  await callLLM(db, spec, 'requirements')
  const q = await latestArtifact(db, specId, 'questions')
  const a = await latestArtifact(db, specId, 'answers')
  const questions: string[] = q ? JSON.parse(q.data).questions : []
  const answers: string[] = a ? JSON.parse(a.data).answers : []
  const ctx = await latestArtifact(db, specId, 'context')
  const claims: (Claim & { verdict: { ok: boolean } })[] = ctx ? JSON.parse(ctx.data).claims.filter((c: any) => c.verdict.ok) : []
  const text = `${spec.title} ${spec.description} ${answers.join(' ')}`
  const rules: Rule[] = triggered(text)
  const frs = fragments(spec.description, spec.title)

  const reqs: { id: string; title: string; ears: string; acceptance: string[]; source_refs: string[]; compliance_refs: string[] }[] = []
  frs.forEach((f, i) => {
    const id = `REQ-${String(i + 1).padStart(3, '0')}`
    const ts = terms(f)
    const refs = claims
      .map((c) => ({ c, s: ts.reduce((n, t) => n + ((c.symbol + c.file).toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 2).map((x) => claimRef(x.c))
    reqs.push({
      id,
      title: f.length > 60 ? f.slice(0, 57) + '...' : f[0].toUpperCase() + f.slice(1),
      ears: `When the user invokes this capability, the system shall ${lowerFirst(f)}.`,
      acceptance: [
        `Given valid input, when the system ${lowerFirst(f)}, then the result is persisted and recorded in the audit trail.`,
        'Given invalid input, when the request is made, then a descriptive error is returned and no partial state is saved.',
      ],
      source_refs: refs,
      compliance_refs: [],
    })
  })
  for (const r of rules) {
    reqs.push({
      id: `REQ-${String(reqs.length + 1).padStart(3, '0')}`,
      title: `${r.id} ${r.title}`,
      ears: r.ears,
      acceptance: [r.criterion],
      source_refs: [],
      compliance_refs: [r.id],
    })
  }

  const md = [
    `# Requirements — ${spec.title}`,
    `> Spec \`${spec.id}\` · ${spec.case_type === 'B' ? 'brownfield' : 'greenfield'} · compliance pack \`${PACK_VERSION}\` · agent output rendered deterministically from JSON`,
    '',
    revisionNote ? `## Revision note\nReviewer asked: _${revisionNote}_\nThis revision incorporates that feedback (see changed items marked **revised**).\n` : '',
    '## Clarifications',
    ...(questions.length ? questions.map((x, i) => `- **Q${i + 1}.** ${x}\n  - **A:** ${answers[i] || '_no answer given_'}`) : ['- none']),
    '',
    '## Functional requirements (EARS)',
    ...reqs.flatMap((r) => [
      `### ${r.id} — ${r.title}`,
      `**EARS:** ${r.ears}`,
      '',
      '**Acceptance criteria**',
      ...r.acceptance.map((x, i) => `- AC-${r.id.slice(4)}.${i + 1}: ${x}`),
      r.source_refs.length ? `\n**Codebase evidence:** ${r.source_refs.join(', ')}` : '',
      r.compliance_refs.length ? `\n**Compliance:** ${r.compliance_refs.map((x) => '`' + x + '`').join(', ')}` : '',
      '',
    ]),
    rules.some((r) => r.note) ? '## Open compliance notes\n' + rules.filter((r) => r.note).map((r) => `- \`${r.id}\`: ${r.note}`).join('\n') : '',
  ].filter((l) => l !== undefined).join('\n')
  await saveArtifact(db, specId, 'requirements', md, { requirements: reqs, rules: rules.map((r) => r.id) }, 'agent:requirement')
}

export async function submitAnswers(db: D1Database, specId: string, answers: string[], userId: string, expectedVersion: number) {
  const q = await latestArtifact(db, specId, 'questions')
  const n = q ? JSON.parse(q.data).questions.length : 0
  const clean = answers.map((a) => String(a || '').slice(0, 1000))
  if (clean.length !== n) throw new GovernanceError('bad_request', `Expected ${n} answers.`, 400)
  await transition(db, specId, 'REQ_DRAFTING', { type: 'human', id: userId }, expectedVersion, 'clarifications_answered')
  await saveArtifact(db, specId, 'answers', ['# Answers', ...clean.map((a, i) => `${i + 1}. ${a || '_blank_'}`)].join('\n'), { answers: clean }, `human:${userId}`)
  await draftRequirements(db, specId)
  await orch(db, specId, 'REQ_AWAITING_APPROVAL', 'requirements_proposed')
}

/* ---------- Design Agent ---------- */
async function draftDesign(db: D1Database, specId: string, revisionNote?: string) {
  const spec = await getSpec(db, specId)
  const req = await latestArtifact(db, specId, 'requirements')
  if (!req) throw new GovernanceError('missing_requirements', 'No requirements artifact exists.')
  const ap = await db
    .prepare("SELECT hash FROM approvals WHERE spec_id = ? AND artifact_type = 'requirements' AND decision = 'approve' ORDER BY id DESC LIMIT 1")
    .bind(specId).first<{ hash: string }>()
  if (!ap || ap.hash !== req.hash) {
    throw new GovernanceError('hash_mismatch', 'Design drafting refused: the approved requirements hash does not match the current requirements artifact.')
  }
  await callLLM(db, spec, 'design')
  const reqData = JSON.parse(req.data) as { requirements: { id: string; title: string; compliance_refs: string[]; source_refs: string[] }[]; rules: string[] }
  const ctx = await latestArtifact(db, specId, 'context')
  const real: Claim[] = ctx ? JSON.parse(ctx.data).claims.filter((c: any) => c.verdict.ok).map((c: any) => ({ file: c.file, line_start: c.line_start, line_end: c.line_end, symbol: c.symbol, claim: c.claim, relevance: c.relevance })) : []
  const drafted: Claim[] = [...real]
  const tdsOn = reqData.rules.some((r) => r.startsWith('TDS'))
  if (spec.case_type === 'B' && spec.inject_flaws) {
    drafted.push(
      { file: 'src/tax/tds393.ts', line_start: 12, line_end: 30, symbol: 'computeSection393', claim: '`computeSection393` already applies the Section 393 rate table', relevance: 'assumed from naming convention' },
      { file: 'src/payments/vendorPayments.ts', line_start: 400, line_end: 420, symbol: 'computeTds', claim: 'TDS is computed in `computeTds` near the end of vendorPayments.ts', relevance: 'recalled from memory' },
      { file: 'src/invoices/einvoice.ts', line_start: 1, line_end: 3, symbol: 'buildEInvoicePayload', claim: '`buildEInvoicePayload` is declared at the top of einvoice.ts', relevance: 'off-by-N lines' },
    )
  }
  const checked = drafted.map((c) => ({ ...c, verdict: verifyClaim(c) }))
  const bad = checked.filter((c) => !c.verdict.ok)
  const good = checked.filter((c) => c.verdict.ok)
  const rate = checked.length ? bad.length / checked.length : 0

  // compliance lint on the raw draft text
  let draftBody = tdsOn && spec.inject_flaws ? 'Deduction logic follows Section 194J for professional fees and Section 194C for contractors.' : 'Deduction logic follows Section 393 of the Income-tax Act 2025.'
  const lint: { code: string; match: string; fix: string }[] = []
  const found = draftBody.match(LEGACY_RE) || []
  for (const m of found) lint.push({ code: 'LEGACY_TDS_SECTION', match: `Section ${m}`, fix: 'Map to a row of the Section 393 table (payment codes 1026/1027 etc.)' })
  if (lint.length) draftBody = 'Deduction logic follows Section 393 of the Income-tax Act 2025 (rows: contractor, professional, technical).'

  const ids = reqData.requirements.map((r) => r.id)
  const md = [
    `# Design — ${spec.title}`,
    `> Spec \`${spec.id}\` · built against approved requirements hash \`${req.hash.slice(0, 12)}\` · compliance pack \`${PACK_VERSION}\``,
    '',
    revisionNote ? `## Revision note\nReviewer asked: _${revisionNote}_\n` : '',
    '## 1. Overview',
    `This design satisfies ${ids.length} requirements (${ids[0]}–${ids[ids.length - 1]}) using the existing service layer where possible and adding only the missing pieces.`,
    '',
    '## 2. Architecture decisions',
    '- Keep orchestration server-side: the orchestrator is the only writer of spec status.',
    '- Agents emit JSON via strict tool use; markdown is rendered deterministically.',
    `- ${draftBody}`,
    '',
    '## 3. Codebase touchpoints (evidence-checked)',
    good.length ? '| Claim | Evidence | Status |\n|---|---|---|\n' + good.map((c) => `| ${c.claim} | ${claimRef(c)} | verified |`).join('\n') : '_Greenfield: no existing code to reference._',
    '',
    bad.length ? `### Flagged claims (dropped before approval)\n| Claim | Evidence | Reason |\n|---|---|---|\n${bad.map((c) => `| ${c.claim} | ${claimRef(c)} | ${c.verdict.reason} |`).join('\n')}\n` : '',
    `**Unverified-claim rate: ${(rate * 100).toFixed(0)}%** (${bad.length} of ${checked.length})`,
    '',
    lint.length ? `## 4. Compliance lint\n${lint.map((l) => `- **Rejected** \`${l.match}\` → ${l.fix}`).join('\n')}\n` : '## 4. Compliance lint\n- No legacy section references found.\n',
    '## 5. Data model changes',
    '- `spec_artifacts` versioned rows with content hash; approvals bind to hash.',
    ...(reqData.rules.some((r) => r.startsWith('GST')) ? ['- `invoices.irn` persisted and invoice locked after registration.'] : []),
    ...(tdsOn ? ['- `vendor_payments.rate_table_version` records the compliance pack version.'] : []),
    '',
    '## 6. Requirement coverage',
    '| Requirement | Design element |',
    '|---|---|',
    ...reqData.requirements.map((r) => `| ${r.id} ${r.title} | ${r.compliance_refs.length ? 'Compliance rule ' + r.compliance_refs.join(', ') : 'Service + API handler'} |`),
  ].join('\n')
  await saveArtifact(db, specId, 'design', md, { claims: checked, unverified_rate: rate, lint, requirement_ids: ids }, 'agent:design')
}

/* ---------- Task Agent ---------- */
async function draftTasks(db: D1Database, specId: string) {
  const spec = await getSpec(db, specId)
  const design = await latestArtifact(db, specId, 'design')
  const req = await latestArtifact(db, specId, 'requirements')
  const ap = await db
    .prepare("SELECT hash FROM approvals WHERE spec_id = ? AND artifact_type = 'design' AND decision = 'approve' ORDER BY id DESC LIMIT 1")
    .bind(specId).first<{ hash: string }>()
  if (!design || !req || !ap || ap.hash !== design.hash) throw new GovernanceError('hash_mismatch', 'Task generation refused: approved design hash does not match current design.')
  await callLLM(db, spec, 'tasks')
  const reqs = (JSON.parse(req.data) as { requirements: { id: string; title: string }[] }).requirements
  await db.prepare('DELETE FROM tasks WHERE spec_id = ?').bind(specId).run()
  const rows = reqs.map((r, i) => ({ key: `TASK-${String(i + 1).padStart(2, '0')}`, title: `Implement ${r.id}: ${r.title}`, req: r.id, test: `T-${r.id}` }))
  for (const t of rows) {
    await db.prepare('INSERT INTO tasks (spec_id, key, title, req_ids, test_id) VALUES (?,?,?,?,?)').bind(specId, t.key, t.title, t.req, t.test).run()
  }
  const md = [
    `# Tasks — ${spec.title}`,
    `> Derived from approved design hash \`${design.hash.slice(0, 12)}\``,
    '',
    '| Task | Requirement | Test |',
    '|---|---|---|',
    ...rows.map((t) => `| ${t.key} ${t.title} | ${t.req} | \`${t.test}\` |`),
  ].join('\n')
  await saveArtifact(db, specId, 'tasks', md, { tasks: rows }, 'agent:task')
}

/* ---------- Human decisions ---------- */
export async function decide(
  db: D1Database, specId: string, userId: string,
  body: { decision: 'approve' | 'reject' | 'request_changes'; comment?: string; version: number; hash: string }
) {
  const spec = await getSpec(db, specId)
  const type = spec.status === 'REQ_AWAITING_APPROVAL' ? 'requirements' : spec.status === 'DESIGN_AWAITING_APPROVAL' ? 'design' : null
  if (!type) throw new GovernanceError('not_awaiting', `Spec is in ${spec.status}; there is nothing to approve.`)
  const art = await latestArtifact(db, specId, type)
  if (!art) throw new GovernanceError('missing_artifact', 'Artifact missing.')
  if (body.hash !== art.hash) throw new GovernanceError('artifact_changed', 'The artifact changed since you opened it. Reload and review the new version.')
  const comment = String(body.comment || '').slice(0, 2000)
  if (body.decision !== 'approve' && !comment.trim()) throw new GovernanceError('bad_request', 'A comment is required when requesting changes or rejecting.', 400)
  const human = { type: 'human' as const, id: userId }
  // Contract: reject and request_changes both go straight back to drafting (a human edge).
  const back: Status = type === 'requirements' ? 'REQ_DRAFTING' : 'DESIGN_DRAFTING'
  const to: Status = body.decision === 'approve' ? (type === 'requirements' ? 'REQ_APPROVED' : 'DESIGN_APPROVED') : back
  await transition(db, specId, to, human, body.version, body.decision === 'approve' ? `${type}_approved` : `${type}_${body.decision === 'reject' ? 'rejected' : 'changes_requested'}`, comment)
  await db
    .prepare('INSERT INTO approvals (spec_id, artifact_type, artifact_version, hash, decision, approver, comment) VALUES (?,?,?,?,?,?,?)')
    .bind(specId, type, art.version, art.hash, body.decision, userId, comment).run()

  if (body.decision === 'approve') {
    if (type === 'requirements') {
      await orch(db, specId, 'DESIGN_DRAFTING', 'design_drafting_started', `requirements hash ${art.hash.slice(0, 12)}`)
      await draftDesign(db, specId)
      await orch(db, specId, 'DESIGN_AWAITING_APPROVAL', 'design_proposed')
    } else {
      await orch(db, specId, 'TASKS_GENERATED', 'tasks_generation_started', `design hash ${art.hash.slice(0, 12)}`)
      await draftTasks(db, specId)
      await orch(db, specId, 'READY_FOR_IMPLEMENTATION', 'ready_for_implementation', 'hook now permits Edit/Write')
    }
  } else if (type === 'requirements') {
    await draftRequirements(db, specId, comment)
    await orch(db, specId, 'REQ_AWAITING_APPROVAL', 'requirements_proposed', 'revision after review')
  } else {
    await draftDesign(db, specId, comment)
    await orch(db, specId, 'DESIGN_AWAITING_APPROVAL', 'design_proposed', 'revision after review')
  }
}

/* ---------- Implementation hand-off (MCP tool simulation + hook) ---------- */
export async function completeTask(db: D1Database, specId: string, key: string, evidence: string) {
  const spec = await getSpec(db, specId)
  if (!WRITE_ALLOWED.includes(spec.status)) throw new GovernanceError('not_ready', `complete_task is not allowed in ${spec.status}.`)
  if (spec.status === 'READY_FOR_IMPLEMENTATION') await orch(db, specId, 'IMPLEMENTING', 'implementation_started', 'first task started')
  const t = await db.prepare('SELECT id, status FROM tasks WHERE spec_id = ? AND key = ?').bind(specId, key).first<{ id: number; status: string }>()
  if (!t) throw new GovernanceError('not_found', 'Task not found', 404)
  await db.prepare("UPDATE tasks SET status = 'done', evidence = ? WHERE id = ?").bind(String(evidence || '').slice(0, 500), t.id).run()
  const left = await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE spec_id = ? AND status != 'done'").bind(specId).first<{ n: number }>()
  if (!left?.n) await orch(db, specId, 'DONE', 'all_tasks_complete')
}

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'LS']
export function hookDecision(status: Status, tool: string) {
  if (READ_ONLY_TOOLS.includes(tool)) return { decision: 'allow', reason: `${tool} is read-only.` }
  if (WRITE_ALLOWED.includes(status)) return { decision: 'allow', reason: `Spec is ${status}; edits are permitted.` }
  return { decision: 'deny', reason: `Spec is ${status}. Edit/Write are blocked until both approvals are recorded (READY_FOR_IMPLEMENTATION).` }
}
