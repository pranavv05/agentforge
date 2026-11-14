import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { randomToken, sha256, hashPassword, safeEqual } from './lib/crypto'
import { GovernanceError, PIPELINE, WRITE_ALLOWED, EDGES, AWAITING_HUMAN, TERMINAL, ALL_STATUSES, checkEdge, modeOf, type SpecRow, type Status, type ActorType } from './lib/fsm'
import {
  getSpec, latestArtifact, runContext, startRequirements, submitAnswers, decide, completeTask, hookDecision, PRICES, PROFILE, costOf,
} from './lib/agents'
import { FIXTURE, FIXTURE_NAME, buildRepoMap, retrieve, verifyClaim, explainVerdict } from './lib/fixture'
import { RULES, LEGACY_RE, PACK_VERSION } from './lib/compliance'
import { LANDING_HTML } from './generated/landing-html'
import { authPage } from './pages/auth'
import { dashboardPage } from './pages/dashboard'
import { docsIndexPage, docsPage } from './pages/docs'
import { productPage, resourcesIndexPage, resourceToolPage, compareIndexPage, comparePage } from './pages/site'

type Bindings = { DB: D1Database }
type User = { id: string; email: string; name: string; is_demo: number }
type Vars = { user: User | null }

const app = new Hono<{ Bindings: Bindings; Variables: Vars }>()

const SESSION_DAYS = 14

/**
 * Proxy-safe same-origin check. Behind CDNs / sandbox proxies the host the Worker sees can differ
 * from the host the browser used, so we trust (in order): Sec-Fetch-Site (set by the browser and
 * not forgeable by page JS), then compare Origin against Host / X-Forwarded-Host / request URL.
 */
function sameOrigin(c: any): boolean {
  const sfs = c.req.header('sec-fetch-site')
  if (sfs) return sfs === 'same-origin' || sfs === 'none'
  const origin = c.req.header('origin')
  if (!origin) return true // non-browser client (curl, server-to-server): no ambient cookie risk
  let oh = ''
  try { oh = new URL(origin).host } catch { return false }
  const hosts = [c.req.header('x-forwarded-host'), c.req.header('host'), new URL(c.req.url).host]
    .filter(Boolean)
    .flatMap((h: string) => h.split(',').map((x) => x.trim()))
  return hosts.includes(oh)
}

function isHttps(c: any): boolean {
  const xfp = (c.req.header('x-forwarded-proto') || '').split(',')[0].trim()
  if (xfp) return xfp === 'https'
  const cfv = c.req.header('cf-visitor')
  if (cfv && cfv.includes('"https"')) return true
  return new URL(c.req.url).protocol === 'https:'
}

/* ---------------- middleware ---------------- */
app.use('/api/*', async (c, next) => {
  // CSRF hardening: cookie is SameSite=Lax; additionally require same-origin for state-changing calls.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (!sameOrigin(c)) {
      return c.json(errBody('FORBIDDEN_ORIGIN', 'Cross-origin request blocked.'), 403)
    }
    const ct = c.req.header('content-type') || ''
    if (!ct.includes('application/json')) {
      return c.json(errBody('BAD_CONTENT_TYPE', 'Content-Type must be application/json.'), 415)
    }
  }
  await next()
})

app.use('/api/*', async (c, next) => {
  c.set('user', null)
  const sid = getCookie(c, 'sid')
  if (sid) {
    const th = await sha256(sid)
    const row = await c.env.DB
      .prepare('SELECT u.id, u.email, u.name, u.is_demo FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
      .bind(th, Date.now())
      .first<User>()
    if (row) c.set('user', row)
  }
  await next()
})

/** Legacy short codes -> @agentforge/contract ERROR_CODES (auth-only codes keep their own name). */
const CONTRACT_CODE: Record<string, string> = {
  bad_request: 'VALIDATION_FAILED', illegal_transition: 'ILLEGAL_TRANSITION', version_conflict: 'VERSION_CONFLICT',
  hash_mismatch: 'HASH_MISMATCH', artifact_changed: 'HASH_MISMATCH', cost_cap: 'BUDGET_EXCEEDED', not_found: 'NOT_FOUND',
  not_awaiting: 'PRECONDITION_FAILED', not_ready: 'PRECONDITION_FAILED', missing_requirements: 'PRECONDITION_FAILED',
  missing_artifact: 'PRECONDITION_FAILED', wrong_actor: 'ILLEGAL_TRANSITION', agent_cannot_transition: 'ILLEGAL_TRANSITION',
  server_error: 'INTERNAL',
}
const errBody = (code: string, message: string, details: unknown = null) => ({
  error: { code: CONTRACT_CODE[code] || code.toUpperCase(), message, details, correlation_id: null as string | null },
  message, // convenience for the bundled UI
})

app.onError((err, c) => {
  if (err instanceof GovernanceError) return c.json(errBody(err.code, err.message), err.http as any)
  console.error(err)
  return c.json(errBody('server_error', 'Something went wrong.'), 500)
})

const needUser = (c: any): User => {
  const u = c.get('user') as User | null
  if (!u) throw new GovernanceError('unauthorized', 'Please sign in.', 401)
  return u
}

async function ownSpec(c: any, id: string): Promise<SpecRow> {
  const u = needUser(c)
  const s = await getSpec(c.env.DB, id)
  if (s.user_id !== u.id) throw new GovernanceError('not_found', 'Spec not found', 404)
  return s
}

async function startSession(c: any, userId: string) {
  const token = randomToken(32)
  await c.env.DB
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * 86400_000)
    .run()
  const secure = isHttps(c)
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: SESSION_DAYS * 86400 })
}

const emailOk = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e)

/* ---------------- auth ---------------- */
app.post('/api/auth/signup', async (c) => {
  const b = await c.req.json().catch(() => null)
  const name = String(b?.name || '').trim().slice(0, 80)
  const email = String(b?.email || '').trim().toLowerCase()
  const password = String(b?.password || '')
  if (name.length < 2) throw new GovernanceError('bad_request', 'Please enter your name.', 400)
  if (!emailOk(email)) throw new GovernanceError('bad_request', 'Please enter a valid email address.', 400)
  if (password.length < 8) throw new GovernanceError('bad_request', 'Password must be at least 8 characters.', 400)
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first()
  if (exists) throw new GovernanceError('email_taken', 'An account with this email already exists.', 409)
  const { hash, salt } = await hashPassword(password)
  const id = 'u_' + randomToken(8)
  await c.env.DB.prepare('INSERT INTO users (id, email, name, pw_hash, pw_salt) VALUES (?,?,?,?,?)').bind(id, email, name, hash, salt).run()
  await startSession(c, id)
  return c.json({ ok: true, user: { id, email, name } }, 201)
})

app.post('/api/auth/login', async (c) => {
  const b = await c.req.json().catch(() => null)
  const email = String(b?.email || '').trim().toLowerCase()
  const password = String(b?.password || '')
  const row = await c.env.DB.prepare('SELECT id, name, email, pw_hash, pw_salt FROM users WHERE email = ? AND is_demo = 0').bind(email).first<any>()
  // always do the hash work to keep timing similar
  const { hash } = await hashPassword(password, row?.pw_salt)
  if (!row || !safeEqual(hash, row.pw_hash)) throw new GovernanceError('invalid_credentials', 'Incorrect email or password.', 401)
  await startSession(c, row.id)
  return c.json({ ok: true, user: { id: row.id, email: row.email, name: row.name } })
})

app.post('/api/auth/demo', async (c) => {
  const db = c.env.DB
  // opportunistic cleanup of stale demo workspaces (specs tied to audit_log stay for governance, so only sessions + demo users w/o specs)
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run()
  const id = 'u_' + randomToken(8)
  const email = `demo-${randomToken(4)}@demo.local`
  const { hash, salt } = await hashPassword(randomToken(8))
  await db.prepare('INSERT INTO users (id, email, name, pw_hash, pw_salt, is_demo) VALUES (?,?,?,?,?,1)').bind(id, email, 'Demo Reviewer', hash, salt).run()
  await startSession(c, id)
  // seed one brownfield spec that is already waiting at the clarification gate
  try {
    await createSpec(db, id, {
      title: 'TDS on vendor payments under Section 393',
      description: 'Deduct TDS automatically on contractor and professional vendor payments. Show the deducted amount on each payment. Reject any reference to the legacy 194-series sections.',
      case_type: 'B', profile: 'dev', cap_usd: 2,
    })
  } catch (e) { console.error(e) }
  return c.json({ ok: true, user: { id, email, name: 'Demo Reviewer' } }, 201)
})

app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, 'sid')
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(sid)).run()
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

// Always 200: lets the static landing page ask "am I signed in?" without a red 401 in the console.
app.get('/api/session', (c) => c.json({ signedIn: !!c.get('user') }))

app.get('/api/me', (c) => {
  const u = c.get('user')
  if (!u) return c.json({ user: null }, 401)
  return c.json({ user: { id: u.id, email: u.email, name: u.name, demo: !!u.is_demo } })
})

/* ---------------- specs ---------------- */
async function createSpec(db: D1Database, userId: string, b: any) {
  const title = String(b?.title || '').trim()
  const description = String(b?.description || '').trim()
  const case_type = b?.mode === 'brownfield' || b?.case_type === 'B' ? 'B' : 'A'
  const profile = b?.profile === 'demo' ? 'demo' : 'dev'
  const cap = Math.min(10, Math.max(0.1, Number(b?.cap_usd) || 2))
  if (title.length < 3 || title.length > 120) throw new GovernanceError('bad_request', 'Title must be 3-120 characters.', 400)
  if (description.length < 10 || description.length > 4000) throw new GovernanceError('bad_request', 'Describe the feature in 10-4000 characters.', 400)
  const id = 'SPEC-' + randomToken(3).toUpperCase()
  await db
    .prepare('INSERT INTO specs (id, user_id, title, description, case_type, repo_url, profile, cap_usd, inject_flaws) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, userId, title, description, case_type, case_type === 'B' ? FIXTURE_NAME : '', profile, cap, b?.inject_flaws === false ? 0 : 1)
    .run()
  await db
    .prepare("INSERT INTO audit_log (spec_id, from_status, to_status, actor_type, actor, action, detail) VALUES (?, 'CREATED', 'CREATED', 'human', ?, 'spec_created', ?)")
    .bind(id, userId, `Case ${case_type}, profile ${profile}, cap $${cap.toFixed(2)}`).run()
  let warning: string | undefined
  try {
    if (case_type === 'B') await runContext(db, id)
    await startRequirements(db, id)
  } catch (e) {
    if (e instanceof GovernanceError) warning = e.message
    else throw e
  }
  return { id, warning }
}

app.post('/api/specs', async (c) => {
  const u = needUser(c)
  const b = await c.req.json().catch(() => null)
  const r = await createSpec(c.env.DB, u.id, b)
  return c.json(r, 201)
})

app.get('/api/specs', async (c) => {
  const u = needUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT s.id, s.title, s.case_type, s.status, s.profile, s.cap_usd, s.created_at, s.updated_at,
              COALESCE((SELECT SUM(cost_usd) FROM llm_calls WHERE spec_id = s.id),0) AS cost
              FROM specs s WHERE s.user_id = ? ORDER BY s.updated_at DESC, s.rowid DESC`)
    .bind(u.id).all()
  return c.json({ specs: results })
})

app.get('/api/specs/:id', async (c) => {
  const spec = await ownSpec(c, c.req.param('id'))
  const db = c.env.DB
  const types = ['context', 'questions', 'answers', 'requirements', 'design', 'tasks']
  const latest: Record<string, any> = {}
  for (const t of types) {
    const a = await latestArtifact(db, spec.id, t)
    if (a) latest[t] = { version: a.version, hash: a.hash, author: a.author, created_at: a.created_at, markdown: a.markdown, data: JSON.parse(a.data) }
  }
  const history = (await db.prepare('SELECT type, version, hash, author, created_at FROM artifacts WHERE spec_id = ? ORDER BY id').bind(spec.id).all()).results
  const approvals = (await db.prepare('SELECT artifact_type, artifact_version, hash, decision, approver, comment, created_at FROM approvals WHERE spec_id = ? ORDER BY id').bind(spec.id).all()).results
  const audit = (await db.prepare('SELECT id, from_status, to_status, actor_type, actor, action, detail, created_at FROM audit_log WHERE spec_id = ? ORDER BY id').bind(spec.id).all()).results
  const calls = (await db.prepare('SELECT stage, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, simulated, created_at FROM llm_calls WHERE spec_id = ? ORDER BY id').bind(spec.id).all()).results as any[]
  const TASK_STATUS: Record<string, string> = { todo: 'pending', done: 'completed' } // DB -> contract TASK_STATUSES
  const tasks = ((await db.prepare('SELECT key, title, req_ids, test_id, status, evidence FROM tasks WHERE spec_id = ? ORDER BY id').bind(spec.id).all()).results as any[]).map((t) => ({ ...t, status: TASK_STATUS[t.status] || t.status }))
  const cost = calls.reduce((s, x) => s + x.cost_usd, 0)
  const uncached = calls.reduce((s, x) => {
    const p = Object.values(PRICES).find((p) => p.label === x.model) || PRICES['haiku-5.5']
    return s + ((x.input_tokens + x.cache_read_tokens + x.cache_write_tokens) * p.in + x.output_tokens * p.out) / 1e6
  }, 0)
  const allowed = EDGES.filter((e) => e.from === spec.status).map((e) => ({ to: e.to, by: e.by }))
  return c.json({
    spec: { ...spec, mode: modeOf(spec.case_type), repo_path: spec.repo_url || null, inject_flaws: !!spec.inject_flaws },
    latest, history, approvals, audit, calls, tasks,
    cost: { total: cost, uncached, cap: spec.cap_usd },
    allowed_transitions: allowed,
    hook: { write_allowed: WRITE_ALLOWED.includes(spec.status) },
  })
})

app.get('/api/specs/:id/artifact/:type/:version', async (c) => {
  const spec = await ownSpec(c, c.req.param('id'))
  const row = await c.env.DB
    .prepare('SELECT type, version, hash, author, created_at, markdown FROM artifacts WHERE spec_id = ? AND type = ? AND version = ?')
    .bind(spec.id, c.req.param('type'), Number(c.req.param('version'))).first()
  if (!row) throw new GovernanceError('not_found', 'Artifact version not found', 404)
  return c.json(row)
})

app.post('/api/specs/:id/answers', async (c) => {
  const u = needUser(c)
  const spec = await ownSpec(c, c.req.param('id'))
  const b = await c.req.json().catch(() => null)
  if (!Array.isArray(b?.answers)) throw new GovernanceError('bad_request', 'answers[] required', 400)
  try {
    await submitAnswers(c.env.DB, spec.id, b.answers, u.id, Number(b.version))
  } catch (e) { if (!(e instanceof GovernanceError)) throw e; throw e }
  return c.json({ ok: true })
})

app.post('/api/specs/:id/decision', async (c) => {
  const u = needUser(c)
  const spec = await ownSpec(c, c.req.param('id'))
  const b = await c.req.json().catch(() => null)
  if (!b) throw new GovernanceError('bad_request', 'JSON body required', 400)
  const d = b.decision === 'changes' ? 'request_changes' : b.decision // 'changes' kept as a legacy alias
  if (!['approve', 'reject', 'request_changes'].includes(d)) throw new GovernanceError('bad_request', 'decision must be approve | reject | request_changes', 400)
  const version = Number(b.expected_version ?? b.version)
  const hash = String(b.content_hash ?? b.hash ?? '')
  await decide(c.env.DB, spec.id, u.id, { decision: d, comment: b.comment, version, hash })
  return c.json({ ok: true })
})

app.post('/api/specs/:id/cap', async (c) => {
  const spec = await ownSpec(c, c.req.param('id'))
  const b = await c.req.json().catch(() => null)
  const cap = Math.min(10, Math.max(0.1, Number(b?.cap_usd)))
  if (!Number.isFinite(cap)) throw new GovernanceError('bad_request', 'cap_usd required', 400)
  await c.env.DB.prepare('UPDATE specs SET cap_usd = ? WHERE id = ?').bind(cap, spec.id).run()
  return c.json({ ok: true, cap_usd: cap })
})

/* implementation hand-off: MCP tool + PreToolUse hook simulation */
app.post('/api/specs/:id/hook', async (c) => {
  const spec = await ownSpec(c, c.req.param('id'))
  const b = await c.req.json().catch(() => null)
  const tool = String(b?.tool || 'Edit').slice(0, 30)
  return c.json({ tool, status: spec.status, ...hookDecision(spec.status, tool) })
})

app.post('/api/specs/:id/tasks/:key/complete', async (c) => {
  const spec = await ownSpec(c, c.req.param('id'))
  const b = await c.req.json().catch(() => null)
  await completeTask(c.env.DB, spec.id, c.req.param('key'), String(b?.evidence || 'completed via MCP complete_task'))
  return c.json({ ok: true })
})

/* ---------------- dashboard stats ---------------- */
app.get('/api/stats', async (c) => {
  const u = needUser(c)
  const db = c.env.DB
  const specs = (await db.prepare('SELECT id, title, status, case_type FROM specs WHERE user_id = ?').bind(u.id).all()).results as any[]
  const byStatus: Record<string, number> = {}
  specs.forEach((s) => (byStatus[s.status] = (byStatus[s.status] || 0) + 1))
  const pending = specs.filter((s) => AWAITING_HUMAN.includes(s.status))
  const costRow = await db.prepare('SELECT COALESCE(SUM(l.cost_usd),0) AS c, COUNT(*) AS n, COALESCE(SUM(l.cache_read_tokens),0) AS cr, COALESCE(SUM(l.input_tokens + l.cache_read_tokens + l.cache_write_tokens),0) AS tin FROM llm_calls l JOIN specs s ON s.id = l.spec_id WHERE s.user_id = ?').bind(u.id).first<any>()
  const designs = (await db.prepare("SELECT a.data FROM artifacts a JOIN specs s ON s.id = a.spec_id WHERE s.user_id = ? AND a.type = 'design' AND a.version = (SELECT MAX(version) FROM artifacts WHERE spec_id = a.spec_id AND type = 'design')").bind(u.id).all()).results as any[]
  let total = 0, bad = 0
  designs.forEach((d) => { const j = JSON.parse(d.data); total += j.claims.length; bad += j.claims.filter((x: any) => !x.verdict.ok).length })
  const comp = (await db.prepare("SELECT a.spec_id, a.data FROM artifacts a JOIN specs s ON s.id = a.spec_id WHERE s.user_id = ? AND a.type = 'requirements' AND a.version = (SELECT MAX(version) FROM artifacts WHERE spec_id = a.spec_id AND type = 'requirements')").bind(u.id).all()).results as any[]
  let compReq = 0, compTraced = 0
  for (const r of comp) {
    const reqs = JSON.parse(r.data).requirements.filter((x: any) => x.compliance_refs.length)
    const tasks = (await db.prepare('SELECT req_ids FROM tasks WHERE spec_id = ?').bind(r.spec_id).all()).results as any[]
    const covered = new Set(tasks.map((t) => t.req_ids))
    compReq += reqs.length
    compTraced += reqs.filter((x: any) => covered.has(x.id)).length
  }
  const recent = (await db.prepare('SELECT a.spec_id, a.from_status, a.to_status, a.actor_type, a.actor, a.action, a.created_at, s.title FROM audit_log a JOIN specs s ON s.id = a.spec_id WHERE s.user_id = ? ORDER BY a.id DESC LIMIT 8').bind(u.id).all()).results
  return c.json({
    total_specs: specs.length, by_status: byStatus, pending: pending.slice(0, 5),
    cost: { total: costRow?.c || 0, calls: costRow?.n || 0, cache_hit_ratio: costRow?.tin ? costRow.cr / costRow.tin : 0 },
    grounding: { claims: total, unverified: bad, rate: total ? bad / total : 0 },
    compliance: { required: compReq, traced: compTraced },
    recent,
  })
})

/* ---------------- lab: retrieval + grounding verifier ---------------- */
app.get('/api/lab/repo', (c) => {
  needUser(c)
  return c.json({
    name: FIXTURE_NAME,
    files: Object.entries(FIXTURE).map(([path, src]) => ({ path, lines: src.split('\n').length })),
    symbols: buildRepoMap(),
  })
})
app.get('/api/lab/file', (c) => {
  needUser(c)
  const p = c.req.query('path') || ''
  if (!(p in FIXTURE)) throw new GovernanceError('not_found', 'File not found', 404)
  return c.json({ path: p, content: FIXTURE[p] })
})
app.post('/api/lab/search', async (c) => {
  needUser(c)
  const b = await c.req.json().catch(() => null)
  const q = String(b?.q || '').slice(0, 500)
  if (q.trim().length < 3) throw new GovernanceError('bad_request', 'Describe a feature (3+ chars).', 400)
  const r = retrieve(q)
  return c.json({ ...r, claims: r.claims.map((x) => { const verdict = verifyClaim(x); return { ...x, verdict, explain: explainVerdict(x, verdict) } }) })
})
app.post('/api/lab/verify', async (c) => {
  needUser(c)
  const b = await c.req.json().catch(() => null)
  const claims = Array.isArray(b?.claims) ? b.claims.slice(0, 20) : []
  return c.json({
    results: claims.map((x: any) => {
      const claim = { file: String(x.file || ''), line_start: Number(x.line_start), line_end: Number(x.line_end), symbol: String(x.symbol || ''), claim: String(x.claim || ''), relevance: '' }
      const verdict = verifyClaim(claim)
      return { ...claim, verdict, explain: explainVerdict(claim, verdict) }
    }),
  })
})
// public, side-effect-free sample for the landing page widget
const SAMPLES = [
  { id: 1, label: 'computeTds is defined in src/tax/tds.ts', file: 'src/tax/tds.ts', line_start: 9, line_end: 17, symbol: 'computeTds' },
  { id: 2, label: 'buildEInvoicePayload builds the IRN payload', file: 'src/invoices/einvoice.ts', line_start: 5, line_end: 20, symbol: 'buildEInvoicePayload' },
  { id: 3, label: 'computeSection393 already applies the new rate table', file: 'src/tax/tds393.ts', line_start: 12, line_end: 30, symbol: 'computeSection393' },
  { id: 4, label: 'payVendor is declared near line 400 of vendorPayments.ts', file: 'src/payments/vendorPayments.ts', line_start: 400, line_end: 420, symbol: 'payVendor' },
  { id: 5, label: 'submitInvoice stores the IRN returned by the portal', file: 'src/invoices/invoiceService.ts', line_start: 1, line_end: 5, symbol: 'submitInvoice' },
]
app.get('/api/public/samples', (c) => c.json({ samples: SAMPLES.map(({ id, label, file, line_start, line_end, symbol }) => ({ id, label, file, line_start, line_end, symbol })) }))
app.post('/api/public/verify', async (c) => {
  const b = await c.req.json().catch(() => null)
  const s = SAMPLES.find((x) => x.id === Number(b?.id))
  if (!s) throw new GovernanceError('bad_request', 'Unknown sample', 400)
  const v = verifyClaim({ ...s, claim: s.label, relevance: '' })
  const src = FIXTURE[s.file]
  const excerpt = src ? src.split('\n').slice(Math.max(0, s.line_start - 1), Math.min(src.split('\n').length, s.line_start + 5)).join('\n') : null
  return c.json({ sample: s, verdict: v, excerpt, explain: explainVerdict({ ...s, claim: s.label, relevance: '' }, v) })
})


/* ---------------- public playgrounds (no login, no side effects) ---------------- */
const sym = (s: any, n = 80) => String(s ?? '').slice(0, n)

app.get('/api/public/states', (c) =>
  c.json({ states: ALL_STATUSES, edges: EDGES, terminal: TERMINAL, awaiting_human: AWAITING_HUMAN, write_allowed: WRITE_ALLOWED, pipeline: PIPELINE }))

app.post('/api/public/transition', async (c) => {
  const b = await c.req.json().catch(() => null)
  const from = sym(b?.from) as Status, to = sym(b?.to) as Status, actor = sym(b?.actor, 20) as ActorType
  if (!ALL_STATUSES.includes(from) || !ALL_STATUSES.includes(to)) throw new GovernanceError('bad_request', 'Unknown state.', 400)
  if (!['human', 'orchestrator', 'agent', 'system'].includes(actor)) throw new GovernanceError('bad_request', 'Unknown actor.', 400)
  const r = checkEdge(from, to, actor)
  const next = EDGES.filter((e) => e.from === from).map((e) => ({ to: e.to, by: e.by }))
  return c.json({ from, to, actor, ...r, next })
})

/** Mirrors the real PreToolUse hook (packages/plugin/src/hook.ts): governs Edit/Write/NotebookEdit/MultiEdit only; fails closed. */
const GOVERNED = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
app.post('/api/public/hook', async (c) => {
  const b = await c.req.json().catch(() => null)
  const status = sym(b?.status) as Status, tool = sym(b?.tool, 30)
  if (!ALL_STATUSES.includes(status)) throw new GovernanceError('bad_request', 'Unknown state.', 400)
  const governed = GOVERNED.includes(tool)
  if (!governed) return c.json({ status, tool, governed, decision: 'allow', exit_code: 0, reason: `${tool} is not a file-editing tool, so the hook does not govern it.`, output: null })
  if (WRITE_ALLOWED.includes(status)) return c.json({ status, tool, governed, decision: 'allow', exit_code: 0, reason: `Spec is ${status}; edits are permitted.`, output: null })
  const reason = `Spec is ${status}. ${tool} is blocked until the requirements and design are both approved (READY_FOR_IMPLEMENTATION).`
  return c.json({
    status, tool, governed, decision: 'deny', exit_code: 2, reason,
    output: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } },
  })
})

app.get('/api/public/files', (c) =>
  c.json({ name: FIXTURE_NAME, files: Object.entries(FIXTURE).map(([path, src]) => ({ path, lines: src.split('\n').length })), symbols: buildRepoMap() }))
app.get('/api/public/file', (c) => {
  const p = c.req.query('path') || ''
  if (!(p in FIXTURE)) throw new GovernanceError('not_found', 'File not found', 404)
  return c.json({ path: p, content: FIXTURE[p] })
})
app.post('/api/public/claim', async (c) => {
  const b = await c.req.json().catch(() => null)
  const claim = { file: sym(b?.file, 200), line_start: Number(b?.line_start), line_end: Number(b?.line_end), symbol: sym(b?.symbol, 80), claim: '', relevance: '' }
  const verdict = verifyClaim(claim)
  const src = FIXTURE[claim.file]
  const n = src ? src.split('\n').length : 0
  return c.json({ claim, verdict, explain: explainVerdict(claim, verdict), file_lines: n })
})

const TDS_TABLE: Record<string, { label: string; individual: number; other: number; code?: string }> = {
  technical: { label: 'Technical services fee', individual: 2, other: 2, code: '1026' },
  professional: { label: 'Professional fee', individual: 10, other: 10, code: '1027' },
  contractor: { label: 'Contractor payment', individual: 1, other: 2 },
}
app.post('/api/public/tds', async (c) => {
  const b = await c.req.json().catch(() => null)
  const row = TDS_TABLE[String(b?.category)]
  const amount = Number(b?.amount)
  if (!row) throw new GovernanceError('bad_request', 'category must be technical | professional | contractor', 400)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) throw new GovernanceError('bad_request', 'amount must be between 0 and 10,000,000,000', 400)
  const individual = b?.payee === 'individual'
  const rate = individual ? row.individual : row.other
  const tds = Math.round((amount * rate) / 100)
  return c.json({
    category: row.label, payee: individual ? 'individual / HUF' : 'company / other', rate, code: row.code || null, amount, tds, net: amount - tds,
    section: 'Section 393, Income-tax Act 2025', pack: PACK_VERSION,
    note: 'Rates come from the demo compliance pack and are illustrative. Thresholds are not modelled. Verify against the official portal before real use.',
  })
})

app.post('/api/public/lint', async (c) => {
  const b = await c.req.json().catch(() => null)
  const text = String(b?.text || '').slice(0, 5000)
  const hits: { match: string; index: number }[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(LEGACY_RE.source, 'g')
  while ((m = re.exec(text))) hits.push({ match: m[0], index: m.index })
  return c.json({ ok: hits.length === 0, hits, version: PACK_VERSION })
})

/* ---------------- compliance ---------------- */
app.get('/api/compliance', (c) => {
  needUser(c)
  return c.json({ version: PACK_VERSION, rules: RULES })
})
app.post('/api/compliance/lint', async (c) => {
  needUser(c)
  const b = await c.req.json().catch(() => null)
  const text = String(b?.text || '').slice(0, 5000)
  const hits: { match: string; index: number; fix: string }[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(LEGACY_RE.source, 'g')
  while ((m = re.exec(text))) hits.push({ match: m[0], index: m.index, fix: 'Map to a row of the Section 393 table (e.g. technical fees 2% code 1026, professional fees 10% code 1027).' })
  return c.json({ ok: hits.length === 0, hits, version: PACK_VERSION })
})

/* ---------------- 20-day plan progress ---------------- */
app.get('/api/plan', async (c) => {
  const u = needUser(c)
  const { results } = await c.env.DB.prepare('SELECT item_key FROM plan_progress WHERE user_id = ? AND done = 1').bind(u.id).all()
  return c.json({ done: (results as any[]).map((r) => r.item_key) })
})
app.post('/api/plan', async (c) => {
  const u = needUser(c)
  const b = await c.req.json().catch(() => null)
  const key = String(b?.key || '').slice(0, 40)
  if (!/^[a-z0-9:_-]+$/i.test(key)) throw new GovernanceError('bad_request', 'bad key', 400)
  await c.env.DB.prepare('INSERT INTO plan_progress (user_id, item_key, done) VALUES (?,?,?) ON CONFLICT(user_id, item_key) DO UPDATE SET done = excluded.done').bind(u.id, key, b?.done ? 1 : 0).run()
  return c.json({ ok: true })
})

app.get('/api/pipeline', (c) => c.json({ pipeline: PIPELINE }))

/* ---------------- pages ---------------- */
async function currentUser(c: any): Promise<User | null> {
  const sid = getCookie(c, 'sid')
  if (!sid) return null
  const db = c.env.DB as D1Database
  return db
    .prepare('SELECT u.id, u.email, u.name, u.is_demo FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(sid), Date.now()).first<User>()
}

// Landing page is the Next.js static export (frontend/). Session state is resolved client-side via /api/me.
app.get('/', (c) => c.html(LANDING_HTML))
app.get('/login', async (c) => (await currentUser(c)) ? c.redirect('/app') : c.html(authPage('login')))
app.get('/signup', async (c) => (await currentUser(c)) ? c.redirect('/app') : c.html(authPage('signup')))
app.get('/app', async (c) => {
  const u = await currentUser(c)
  if (!u) return c.redirect('/login?next=/app')
  return c.html(dashboardPage(u))
})
app.get('/app/*', (c) => c.redirect('/app'))
app.get('/product/:slug', async (c) => {
  const h = productPage(c.req.param('slug'), !!(await currentUser(c)))
  return h ? c.html(h) : c.html(authPage('notfound'), 404)
})
app.get('/resources', async (c) => c.html(resourcesIndexPage(!!(await currentUser(c)))))
app.get('/resources/:slug', async (c) => {
  const h = resourceToolPage(c.req.param('slug'), !!(await currentUser(c)))
  return h ? c.html(h) : c.html(authPage('notfound'), 404)
})
app.get('/compare', async (c) => c.html(compareIndexPage(!!(await currentUser(c)))))
app.get('/compare/:slug', async (c) => {
  const h = comparePage(c.req.param('slug'), !!(await currentUser(c)))
  return h ? c.html(h) : c.html(authPage('notfound'), 404)
})
app.get('/docs', async (c) => c.html(docsIndexPage(!!(await currentUser(c)))))
app.get('/docs/:slug', async (c) => {
  const html = docsPage(c.req.param('slug'), !!(await currentUser(c)))
  return html ? c.html(html) : c.html('<h1>Not found</h1>', 404)
})
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json(errBody('not_found', 'Not found'), 404) : c.html(authPage('notfound'), 404)))

export default app
