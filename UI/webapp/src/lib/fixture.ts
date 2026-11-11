// Embedded sample brownfield repo ("acme-erp") used by the Context Agent + grounding verifier demo.
export const FIXTURE_NAME = 'acme-erp (embedded sample repo)'

export const FIXTURE: Record<string, string> = {
  'src/invoices/invoiceService.ts': `import { db } from '../db/schema'
import { buildEInvoicePayload } from './einvoice'

export interface InvoiceItem {
  hsn: string
  description: string
  qty: number
  unitPrice: number
  gstRate: number
}

export interface Invoice {
  id: string
  sellerGstin: string
  buyerGstin: string
  items: InvoiceItem[]
  total: number
  irn?: string
}

export async function createInvoice(input: Omit<Invoice, 'id' | 'total'>): Promise<Invoice> {
  const total = input.items.reduce((s, i) => s + i.qty * i.unitPrice * (1 + i.gstRate / 100), 0)
  const invoice: Invoice = { ...input, id: crypto.randomUUID(), total }
  await db.insert('invoices', invoice)
  return invoice
}

export async function submitInvoice(id: string): Promise<Invoice> {
  const invoice = await db.get<Invoice>('invoices', id)
  const payload = buildEInvoicePayload(invoice)
  const res = await fetch(process.env.EINV_URL!, { method: 'POST', body: JSON.stringify(payload) })
  const { Irn } = await res.json()
  await db.update('invoices', id, { irn: Irn })
  return { ...invoice, irn: Irn }
}
`,
  'src/invoices/einvoice.ts': `import type { Invoice } from './invoiceService'

export const EINVOICE_SCHEMA_VERSION = '1.1'

export function buildEInvoicePayload(inv: Invoice) {
  return {
    Version: EINVOICE_SCHEMA_VERSION,
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B' },
    DocDtls: { Typ: 'INV', No: inv.id },
    SellerDtls: { Gstin: inv.sellerGstin },
    BuyerDtls: { Gstin: inv.buyerGstin },
    ItemList: inv.items.map((i, n) => ({
      SlNo: String(n + 1),
      HsnCd: i.hsn,
      Qty: i.qty,
      UnitPrice: i.unitPrice,
      GstRt: i.gstRate,
    })),
    ValDtls: { TotInvVal: inv.total },
  }
}

export function isEInvoiceMandatory(turnoverCrore: number) {
  return turnoverCrore > 5
}
`,
  'src/payments/vendorPayments.ts': `import { db } from '../db/schema'
import { computeTds } from '../tax/tds'

export interface VendorPayment {
  id: string
  vendorId: string
  category: 'contractor' | 'professional' | 'technical' | 'rent'
  vendorType: 'individual' | 'company'
  amount: number
  tdsDeducted: number
}

export async function payVendor(p: Omit<VendorPayment, 'id' | 'tdsDeducted'>) {
  const tds = computeTds(p.category, p.vendorType, p.amount)
  const payment: VendorPayment = { ...p, id: crypto.randomUUID(), tdsDeducted: tds }
  await db.insert('vendor_payments', payment)
  return payment
}

export async function listVendorPayments(vendorId: string) {
  return db.query<VendorPayment>('vendor_payments', { vendorId })
}
`,
  'src/tax/tds.ts': `// TDS calculation. NOTE: still keyed on legacy Income-tax Act 1961 sections.
export const TDS_RULES = {
  contractor: { individual: 1, company: 2, section: '194C' },
  professional: { individual: 10, company: 10, section: '194J' },
  technical: { individual: 2, company: 2, section: '194J' },
  rent: { individual: 10, company: 10, section: '194I' },
} as const

export function computeTds(
  category: keyof typeof TDS_RULES,
  vendorType: 'individual' | 'company',
  amount: number
) {
  const rule = TDS_RULES[category]
  const rate = rule[vendorType]
  return Math.round((amount * rate) / 100)
}

export function legacySectionFor(category: keyof typeof TDS_RULES) {
  return TDS_RULES[category].section
}
`,
  'src/db/schema.ts': `export const db = {
  async insert(table: string, row: unknown) { /* ... */ },
  async get<T>(table: string, id: string): Promise<T> { /* ... */ return {} as T },
  async update(table: string, id: string, patch: unknown) { /* ... */ },
  async query<T>(table: string, where: object): Promise<T[]> { /* ... */ return [] },
}

export const TABLES = ['invoices', 'vendor_payments', 'vendors', 'ledger_entries']
`,
  'src/api/routes.ts': `import { createInvoice, submitInvoice } from '../invoices/invoiceService'
import { payVendor, listVendorPayments } from '../payments/vendorPayments'

export function registerRoutes(app: any) {
  app.post('/api/invoices', async (c: any) => c.json(await createInvoice(await c.req.json())))
  app.post('/api/invoices/:id/submit', async (c: any) => c.json(await submitInvoice(c.req.param('id'))))
  app.post('/api/vendor-payments', async (c: any) => c.json(await payVendor(await c.req.json())))
  app.get('/api/vendors/:id/payments', async (c: any) => c.json(await listVendorPayments(c.req.param('id'))))
}
`,
  'src/reports/ledgerReport.ts': `import { db } from '../db/schema'

export async function monthlyLedger(month: string) {
  const rows = await db.query<{ amount: number; month: string }>('ledger_entries', { month })
  return rows.reduce((s, r) => s + r.amount, 0)
}
`,
}

export type Symbol = { name: string; kind: string; file: string; line: number; end: number }

const SYM_RE = /^(export\s+)?(async\s+)?(function|class|interface|const|type)\s+([A-Za-z0-9_]+)/

/** Stage 0 of the Context Agent: deterministic "repo map" - definitions per file (regex stand-in for tree-sitter). */
export function buildRepoMap(): Symbol[] {
  const out: Symbol[] = []
  for (const [file, src] of Object.entries(FIXTURE)) {
    const lines = src.split('\n')
    const starts: { name: string; kind: string; line: number }[] = []
    lines.forEach((l, i) => {
      const m = SYM_RE.exec(l)
      if (m) starts.push({ name: m[4], kind: m[3], line: i + 1 })
    })
    starts.forEach((s, idx) => {
      let end = idx + 1 < starts.length ? starts[idx + 1].line - 1 : lines.length
      while (end > s.line && lines[end - 1].trim() === '') end--
      out.push({ ...s, file, end })
    })
  }
  return out
}

export type Claim = {
  file: string
  line_start: number
  line_end: number
  symbol: string
  claim: string
  relevance: string
}

export type Verdict = { ok: boolean; reason: 'ok' | 'file_not_found' | 'range_invalid' | 'symbol_not_in_range' }

/** Stage 3 grounding verifier: deterministic, no LLM. */
export function verifyClaim(c: Claim): Verdict {
  const src = FIXTURE[c.file]
  if (src === undefined) return { ok: false, reason: 'file_not_found' }
  const lines = src.split('\n')
  if (!(c.line_start >= 1 && c.line_end >= c.line_start && c.line_end <= lines.length)) {
    return { ok: false, reason: 'range_invalid' }
  }
  const slice = lines.slice(c.line_start - 1, c.line_end).join('\n')
  if (!slice.includes(c.symbol)) return { ok: false, reason: 'symbol_not_in_range' }
  return { ok: true, reason: 'ok' }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'should', 'shall', 'want', 'have', 'will', 'into', 'when', 'each', 'all', 'are', 'can', 'new', 'add', 'use', 'our', 'any', 'not', 'but', 'its', 'has', 'system', 'user', 'users'])
const SYN: Record<string, string[]> = {
  einvoice: ['einvoice', 'invoice', 'irn'],
  'e-invoice': ['einvoice', 'invoice', 'irn'],
  gst: ['gstin', 'gst', 'einvoice', 'invoice'],
  tds: ['tds', 'vendor', 'payment'],
  vendor: ['vendor', 'payment'],
  payment: ['payment', 'vendor'],
  contractor: ['tds', 'vendor'],
  ledger: ['ledger'],
  report: ['report', 'ledger'],
}

export function terms(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z][a-z-]{2,}/g) || []).filter((w) => !STOP.has(w))
  const set = new Set<string>()
  for (const w of words) {
    set.add(w)
    for (const s of SYN[w] || []) set.add(s)
  }
  return [...set]
}

export type Retrieval = {
  files: { file: string; score: number }[]
  claims: Claim[]
  toolCalls: { tool: string; args: string; hits: number }[]
}

/** Stage 2 (simulated agentic loop): FTS-style scoring + ranged reads over the fixture. Deterministic. */
export function retrieve(text: string): Retrieval {
  const ts = terms(text)
  const map = buildRepoMap()
  const toolCalls: Retrieval['toolCalls'] = [{ tool: 'repo_map', args: 'focus=*', hits: map.length }]
  const fileScore: Record<string, number> = {}
  for (const [file, src] of Object.entries(FIXTURE)) {
    const low = src.toLowerCase()
    let sc = 0
    for (const t of ts) {
      if (file.toLowerCase().includes(t)) sc += 4
      const occ = low.split(t).length - 1
      sc += Math.min(occ, 6)
    }
    fileScore[file] = sc
  }
  toolCalls.push({ tool: 'fts_search', args: `q="${ts.slice(0, 6).join(' ')}"`, hits: Object.values(fileScore).filter((s) => s > 0).length })
  const files = Object.entries(fileScore)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([file, score]) => ({ file, score }))
  const claims: Claim[] = []
  for (const f of files) {
    toolCalls.push({ tool: 'read', args: `${f.file}`, hits: 1 })
    const syms = map.filter((s) => s.file === f.file)
    const ranked = syms
      .map((s) => ({ s, sc: ts.reduce((a, t) => a + (s.name.toLowerCase().includes(t) ? 3 : 0), 0) }))
      .sort((a, b) => b.sc - a.sc || a.s.line - b.s.line)
      .slice(0, 2)
    for (const { s } of ranked) {
      claims.push({
        file: s.file,
        line_start: s.line,
        line_end: s.end,
        symbol: s.name,
        claim: `${s.kind} \`${s.name}\` is defined here and is relevant to the requested change`,
        relevance: `matched terms: ${ts.filter((t) => (s.name + ' ' + s.file).toLowerCase().includes(t)).slice(0, 3).join(', ') || 'structural neighbour'}`,
      })
    }
  }
  return { files, claims, toolCalls }
}

/** Where is a symbol really defined? (repo map lookup) */
export function locate(symbol: string) {
  const s = buildRepoMap().find((x) => x.name === symbol)
  return s ? { file: s.file, line_start: s.line, line_end: s.end } : null
}

/**
 * Turns a failed verdict into advice. A failed check is the verifier doing its job, so each one
 * says what is wrong, where the real thing lives (if anywhere), and what the agent should do next.
 */
export function explainVerdict(c: Claim, v: Verdict): { title: string; why: string; fix: string; alt: { file: string; line_start: number; line_end: number } | null } | null {
  if (v.ok) return null
  const real = locate(c.symbol)
  if (v.reason === 'file_not_found') {
    const base = (c.file.split('/').pop() || '').replace(/\.\w+$/, '').toLowerCase()
    let near: string | null = null, best = 0
    for (const f of Object.keys(FIXTURE)) {
      const b = (f.split('/').pop() || '').replace(/\.\w+$/, '').toLowerCase()
      let k = 0
      while (k < b.length && k < base.length && b[k] === base[k]) k++
      if (k > best) { best = k; near = f }
    }
    return {
      title: 'Caught: that file does not exist',
      why: `The agent cited ${c.file}, but the repository has no such path. A model can invent a plausible file name; the verifier cannot be talked into believing it.`,
      fix: real
        ? `${c.symbol} actually lives in ${real.file}:L${real.line_start}-L${real.line_end}. The agent must re-cite it there.`
        : `No definition of ${c.symbol} exists anywhere in the repo${near && best >= 3 ? ` (closest file: ${near})` : ''}. The agent must drop the claim, or rewrite it as work to be created.`,
      alt: real,
    }
  }
  if (v.reason === 'range_invalid') {
    const len = (FIXTURE[c.file] || '').split('\n').length
    return {
      title: 'Caught: those lines are outside the file',
      why: `The agent cited lines ${c.line_start}-${c.line_end} of ${c.file}, but the file only has ${len} lines (or the range is backwards).`,
      fix: real ? `${c.symbol} is at ${real.file}:L${real.line_start}-L${real.line_end}. The agent must re-cite with that range.` : 'The agent must re-read the file and cite a range that exists.',
      alt: real,
    }
  }
  return {
    title: 'Caught: the symbol is not in those lines',
    why: `${c.file} lines ${c.line_start}-${c.line_end} exist, but ${c.symbol} does not appear in them. The citation points at the wrong place.`,
    fix: real ? `${c.symbol} is defined at ${real.file}:L${real.line_start}-L${real.line_end}. The agent must re-cite with that range.` : 'The agent must find where the symbol is really defined, or remove the claim.',
    alt: real,
  }
}
