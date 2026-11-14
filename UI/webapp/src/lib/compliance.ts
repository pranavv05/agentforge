// Versioned compliance pack (demo subset, capped well under the plan's ~15 rule limit).
export const PACK_VERSION = '2026.11-demo'

export type Rule = {
  id: string
  family: 'GST' | 'TDS'
  title: string
  triggers: string[]
  ears: string
  criterion: string
  note?: string
}

export const RULES: Rule[] = [
  {
    id: 'GST-01', family: 'GST', title: 'E-invoice mandatory fields',
    triggers: ['gst', 'invoice', 'einvoice', 'e-invoice', 'irn'],
    ears: 'When an e-invoice payload is generated, the system shall include seller GSTIN, buyer GSTIN, document number, HSN code per line and total invoice value.',
    criterion: 'Given an invoice, when the e-invoice JSON is built, then SellerDtls.Gstin, BuyerDtls.Gstin, DocDtls.No, ItemList[].HsnCd and ValDtls.TotInvVal are all present and non-empty.',
  },
  {
    id: 'GST-02', family: 'GST', title: 'E-invoice applicability threshold',
    triggers: ['gst', 'invoice', 'einvoice', 'e-invoice', 'irn'],
    ears: 'While aggregate turnover exceeds the configured threshold, the system shall require an e-invoice before an invoice can be issued.',
    criterion: 'Given turnover above INR 5 crore (configurable), when an invoice is finalised without an IRN, then finalisation is blocked.',
    note: 'Threshold per NIC release notes cited in the build plan; keep configurable.',
  },
  {
    id: 'GST-03', family: 'GST', title: 'IRN persistence and immutability',
    triggers: ['gst', 'invoice', 'einvoice', 'e-invoice', 'irn'],
    ears: 'When a registration response returns an IRN, the system shall persist it against the invoice and lock the invoice from edits.',
    criterion: 'Given a successful submission, when the IRN is stored, then subsequent edits to the invoice are rejected with a clear error.',
  },
  {
    id: 'TDS-01', family: 'TDS', title: 'Income-tax Act 2025, Section 393 mapping',
    triggers: ['tds', 'vendor', 'contractor', 'professional', 'payment', 'deduct', 'withholding'],
    ears: 'When tax is deducted at source, the system shall reference Section 393 of the Income-tax Act 2025 and shall not reference the legacy 194-series sections.',
    criterion: 'Given any TDS computation, when the rule table is resolved, then no identifier matches /194[A-Z]*/ and each payment category maps to a Section 393 table row.',
  },
  {
    id: 'TDS-02', family: 'TDS', title: 'Technical and professional fee rates',
    triggers: ['tds', 'professional', 'technical', 'fees', 'vendor'],
    ears: 'When a technical-service fee is paid the system shall deduct 2% (payment code 1026); for professional fees it shall deduct 10% (payment code 1027).',
    criterion: 'Given a technical fee of INR 100,000, when TDS is computed, then INR 2,000 is deducted; given a professional fee of INR 100,000, then INR 10,000 is deducted.',
    note: 'Source conflict in the plan: one source gives threshold INR 30,000 and codes 1030/1031. Confirm against the CBDT / Income Tax portal before encoding.',
  },
  {
    id: 'TDS-03', family: 'TDS', title: 'Contractor payment rates',
    triggers: ['tds', 'contractor', 'vendor', 'payment'],
    ears: 'When a contractor is paid, the system shall deduct 1% for individuals/HUF and 2% for all other payee types.',
    criterion: 'Given a contractor payment of INR 100,000 to an individual, TDS is INR 1,000; to a company, TDS is INR 2,000.',
  },
  {
    id: 'TDS-04', family: 'TDS', title: 'Versioned rate table',
    triggers: ['tds', 'vendor', 'payment', 'contractor', 'professional'],
    ears: 'The system shall load TDS rates and thresholds from a versioned table and record the table version on every deduction.',
    criterion: 'Given a deduction, when it is persisted, then the compliance pack version is stored alongside it.',
  },
]

export function triggered(text: string): Rule[] {
  const low = text.toLowerCase()
  return RULES.filter((r) => r.triggers.some((t) => low.includes(t)))
}

export const LEGACY_RE = /\b194[A-Z]{0,2}\b/g
