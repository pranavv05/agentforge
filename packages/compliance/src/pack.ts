import { CompliancePackSchema, type CompliancePack } from '@agentforge/contract';

/**
 * The Indian SMB compliance pack.
 *
 * Two domains, fifteen rules, each turning an obligation into Given/When/Then criteria
 * that get injected into requirements and traced forward to a task and a test.
 *
 * ## What is encoded, and what deliberately is not
 *
 * Rates and payment codes appear **only** where the project's research document states
 * them. Where it does not, the rule is written as a *structural* obligation — a field
 * must be present, a code must be recorded, a citation must resolve — rather than
 * inventing a number. A fabricated tax rate in a tool whose selling point is verifiable
 * compliance would be self-defeating, and far worse than a narrower pack.
 *
 * ## This pack has not been reviewed by a tax professional
 *
 * `reviewed_on` records when the content was last checked against the cited sources,
 * not a professional sign-off. Before any real use, every rate, threshold and payment
 * code needs confirming against the CBDT / Income Tax portal and the current NIC
 * e-invoice schema. `source_conflict_note` records the disagreements already known.
 *
 * ## Why the pack is versioned
 *
 * The Income-tax Act 2025 took effect on 1 April 2026 and dissolved the 194-series:
 * what was Section 194C, 194I or 194J is now a row in the Section 393 table. A design
 * citing "Section 194J" is not a style problem, it is wrong law — and an unversioned
 * compliance checklist would have gone on asserting it indefinitely. That is the case
 * the superseded-term detector exists to catch, and the reason the pack carries a
 * semver that approvals record.
 */

const PACK_VERSION = '1.0.0';

/** ISO date the content was last compared against the cited sources. */
const REVIEWED_ON = '2026-11-11';

const RAW: CompliancePack = {
  version: PACK_VERSION,
  reviewed_on: REVIEWED_ON,
  rules: [
    // ---------------------------------------------------------------------
    // GST e-invoice. Field obligations taken from the public NIC schema
    // documentation. No live IRP integration is implied or required.
    // ---------------------------------------------------------------------
    {
      key: 'GST-001',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Supplier identification is complete on every e-invoice',
      requirement_text:
        'An e-invoice payload must carry the supplier GSTIN, legal name, address, place, ' +
        'state code and pincode. A payload missing any of them cannot be registered.',
      acceptance_criteria: [
        {
          given: 'an invoice whose supplier record has no GSTIN',
          when: 'the e-invoice payload is generated',
          then: 'generation is refused with a field-level error naming the supplier GSTIN',
        },
        {
          given: 'an invoice with a complete supplier record',
          when: 'the e-invoice payload is generated',
          then: 'the payload contains supplier GSTIN, legal name, address, place, state code and pincode',
        },
      ],
      applies_when_any: [
        'invoice',
        'e-invoice',
        'einvoice',
        'gst',
        'irn',
        'billing',
        'tax invoice',
      ],
      superseded_terms: [],
      citation: 'NIC e-invoice schema, supplier (SellerDtls) mandatory fields.',
      source_conflict_note: null,
    },
    {
      key: 'GST-002',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Buyer identification and place of supply are present',
      requirement_text:
        'An e-invoice payload must carry the buyer legal name, address, place of supply and ' +
        'state code, and the buyer GSTIN for a registered recipient.',
      acceptance_criteria: [
        {
          given: 'an invoice to a registered buyer with no GSTIN recorded',
          when: 'the e-invoice payload is generated',
          then: 'generation is refused with a field-level error naming the buyer GSTIN',
        },
        {
          given: 'an invoice with no place of supply',
          when: 'the e-invoice payload is generated',
          then: 'generation is refused, because the place of supply determines the tax treatment',
        },
      ],
      applies_when_any: ['invoice', 'e-invoice', 'einvoice', 'gst', 'buyer', 'customer', 'billing'],
      superseded_terms: [],
      citation: 'NIC e-invoice schema, buyer (BuyerDtls) mandatory fields.',
      source_conflict_note: null,
    },
    {
      key: 'GST-003',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Invoice numbering is a gap-free series within each financial year',
      requirement_text:
        'Invoice numbers must form a consecutive series within a financial year, be at most ' +
        '16 characters, and use only alphanumerics, slash and hyphen. Gaps and reuse are both ' +
        'defects: the series is what ties a filing to its invoices.',
      acceptance_criteria: [
        {
          given: 'the last invoice of the current financial year is numbered 41',
          when: 'another invoice is finalised',
          then: 'it is numbered 42, with no gap',
        },
        {
          given: 'two invoices are finalised at the same moment',
          when: 'both request a number',
          then: 'they receive different consecutive numbers and neither is reused',
        },
        {
          given: 'an invoice dated on or after 1 April',
          when: 'it is finalised',
          then: 'it starts the new financial year series rather than continuing the previous one',
        },
        {
          given:
            'a proposed invoice number longer than 16 characters or containing other punctuation',
          when: 'it is validated',
          then: 'it is rejected',
        },
      ],
      applies_when_any: [
        'invoice',
        'numbering',
        'series',
        'sequence',
        'gst',
        'billing',
        'financial year',
      ],
      superseded_terms: [],
      citation:
        'CGST Rule 46(b): consecutive serial number, maximum sixteen characters, alphanumerics, slash and hyphen only, unique for a financial year.',
      source_conflict_note: null,
    },
    {
      key: 'GST-004',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Document type is explicit and from the permitted set',
      requirement_text:
        'Every payload must declare its document type as invoice, credit note or debit note. ' +
        'The type governs how the document is treated, so it may never be inferred.',
      acceptance_criteria: [
        {
          given: 'a payload with no document type',
          when: 'it is validated',
          then: 'it is rejected rather than defaulted to an invoice',
        },
        {
          given: 'a payload declaring a document type outside the permitted set',
          when: 'it is validated',
          then: 'it is rejected with the permitted values listed',
        },
      ],
      applies_when_any: ['invoice', 'credit note', 'debit note', 'e-invoice', 'einvoice', 'gst'],
      superseded_terms: [],
      citation: 'NIC e-invoice schema, document type (DocDtls.Typ): INV, CRN, DBN.',
      source_conflict_note: null,
    },
    {
      key: 'GST-005',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Each line item carries an HSN code and a taxable value',
      requirement_text:
        'Every line item must carry an HSN code, quantity, unit, unit price, taxable value and ' +
        'the applicable GST rate. The classification drives the rate, so it cannot be omitted.',
      acceptance_criteria: [
        {
          given: 'a line item with no HSN code',
          when: 'the payload is generated',
          then: 'generation is refused with a field-level error naming the line and the HSN code',
        },
        {
          given:
            'a line item whose taxable value does not equal quantity times unit price less discount',
          when: 'the payload is validated',
          then: 'it is rejected rather than submitted with an inconsistent total',
        },
      ],
      applies_when_any: ['invoice', 'line item', 'hsn', 'gst', 'item', 'billing', 'product'],
      superseded_terms: [],
      citation: 'NIC e-invoice schema, item list (ItemList) mandatory fields.',
      source_conflict_note: null,
    },
    {
      key: 'GST-006',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'The IRN is received from the portal, never generated locally',
      requirement_text:
        'The Invoice Reference Number is assigned by the Invoice Registration Portal. The system ' +
        'may compute a payload hash but must never present a locally derived value as an IRN.',
      acceptance_criteria: [
        {
          given: 'an e-invoice payload that has not been registered',
          when: 'the invoice is displayed or exported',
          then: 'no IRN is shown, and the registration status is reported as pending',
        },
        {
          given: 'a locally computed hash of the payload',
          when: 'it is stored',
          then: 'it is stored in a field distinct from the IRN and never rendered as one',
        },
      ],
      applies_when_any: ['irn', 'e-invoice', 'einvoice', 'invoice registration', 'gst', 'irp'],
      superseded_terms: [],
      citation: 'NIC e-invoice API: the IRN is returned by the IRP on successful registration.',
      source_conflict_note: null,
    },
    {
      key: 'GST-007',
      domain: 'GST',
      jurisdiction: 'IN',
      severity: 'warning',
      title: 'Reverse charge is stated explicitly',
      requirement_text:
        'The reverse-charge applicability flag must be set explicitly on every payload, because ' +
        'it moves the liability to the recipient. An absent flag must not be read as "no".',
      acceptance_criteria: [
        {
          given: 'an invoice where reverse charge has not been determined',
          when: 'the payload is generated',
          then: 'generation is refused rather than defaulting the flag to false',
        },
      ],
      applies_when_any: ['reverse charge', 'invoice', 'e-invoice', 'einvoice', 'gst', 'liability'],
      superseded_terms: [],
      citation: 'NIC e-invoice schema, transaction details reverse-charge flag (TranDtls.RegRev).',
      source_conflict_note: null,
    },

    // ---------------------------------------------------------------------
    // TDS under the Income-tax Act 2025. The 194-series no longer exists;
    // each former section is a row in the Section 393 table.
    // ---------------------------------------------------------------------
    {
      key: 'TDS-001',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Deductions cite the Income-tax Act 2025, not the dissolved 194-series',
      requirement_text:
        'Every deduction must cite its Section 393 table row. The Income-tax Act 2025 took effect ' +
        'on 1 April 2026 and the 194-series ceased to exist, so a citation to Section 194C, 194I, ' +
        '194J or any other 194-series provision is wrong law, not merely outdated wording.',
      acceptance_criteria: [
        {
          given: 'a deduction configured against Section 194J',
          when: 'it is validated',
          then: 'it is rejected and the Section 393 equivalent is named in the error',
        },
        {
          given: 'a deduction citing a Section 393 table row',
          when: 'it is validated',
          then: 'it is accepted and the cited row is recorded with the deduction',
        },
      ],
      applies_when_any: [
        'tds',
        'deduction',
        'withholding',
        'payout',
        'vendor payment',
        'contractor',
        'professional fees',
        'income tax',
      ],
      // The demo case: these are detected in requirement and design text and mapped.
      superseded_terms: [
        {
          pattern: 'section\\s*194\\s*-?\\s*J',
          replacement: 'Section 393 (fees for professional services)',
          explanation:
            'Section 194J was dissolved by the Income-tax Act 2025. Professional fees are now a row in the Section 393 table.',
        },
        {
          pattern: 'section\\s*194\\s*-?\\s*C',
          replacement: 'Section 393 (payments to contractors)',
          explanation:
            'Section 194C was dissolved by the Income-tax Act 2025. Contractor payments are now a row in the Section 393 table.',
        },
        {
          pattern: 'section\\s*194\\s*-?\\s*I',
          replacement: 'Section 393 (rent)',
          explanation:
            'Section 194I was dissolved by the Income-tax Act 2025. Rent is now a row in the Section 393 table.',
        },
        {
          pattern: 'section\\s*194\\s*-?\\s*[A-Z]{1,2}\\b',
          replacement: 'the corresponding Section 393 table row',
          explanation:
            'The entire 194-series was dissolved by the Income-tax Act 2025. Each former section is now a row in the Section 393 table.',
        },
      ],
      citation:
        'Income-tax Act 2025, Section 393 (TDS table), in force 1 April 2026; replaces the Income-tax Act 1961 194-series.',
      source_conflict_note: null,
    },
    {
      key: 'TDS-002',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Professional fees are deducted at 10 per cent under payment code 1027',
      requirement_text:
        'A payment for professional services attracts deduction at 10 per cent, recorded under ' +
        'payment code 1027.',
      acceptance_criteria: [
        {
          given: 'a professional-services invoice above the applicable threshold',
          when: 'the payout is prepared',
          then: 'tax is deducted at 10 per cent and payment code 1027 is recorded',
        },
        {
          given: 'a professional-services deduction recorded under any other payment code',
          when: 'it is validated',
          then: 'it is rejected, because the code determines how the deduction is reported',
        },
      ],
      applies_when_any: [
        'tds',
        'professional fees',
        'professional services',
        'consultant',
        'deduction',
        'payout',
        'vendor payment',
      ],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393 table: professional fees, 10%, payment code 1027.',
      source_conflict_note:
        'Rate and code are consistent across the sources reviewed, but must be confirmed against the CBDT portal before production use.',
    },
    {
      key: 'TDS-003',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Technical service fees are deducted at 2 per cent under payment code 1026',
      requirement_text:
        'A payment for technical services attracts deduction at 2 per cent, recorded under ' +
        'payment code 1026. Technical and professional services carry different rates, so the ' +
        'classification must be explicit rather than inferred from the vendor.',
      acceptance_criteria: [
        {
          given: 'a technical-services invoice above the applicable threshold',
          when: 'the payout is prepared',
          then: 'tax is deducted at 2 per cent and payment code 1026 is recorded',
        },
        {
          given: 'an invoice that could be either technical or professional services',
          when: 'the payout is prepared without an explicit classification',
          then: 'preparation is refused rather than applying either rate by default',
        },
      ],
      applies_when_any: [
        'tds',
        'technical services',
        'technical fees',
        'deduction',
        'payout',
        'vendor payment',
      ],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393 table: technical services, 2%, payment code 1026.',
      source_conflict_note:
        'Rate and code are consistent across the sources reviewed, but must be confirmed against the CBDT portal before production use.',
    },
    {
      key: 'TDS-004',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Contractor deduction depends on the deductee being an individual or HUF',
      requirement_text:
        'A payment to a contractor attracts deduction at 1 per cent where the deductee is an ' +
        'individual or a Hindu Undivided Family, and 2 per cent otherwise. The deductee ' +
        'constitution therefore has to be recorded before a payout can be computed.',
      acceptance_criteria: [
        {
          given: 'a contractor payment to an individual or HUF',
          when: 'the payout is prepared',
          then: 'tax is deducted at 1 per cent',
        },
        {
          given: 'a contractor payment to a company, firm or other non-individual deductee',
          when: 'the payout is prepared',
          then: 'tax is deducted at 2 per cent',
        },
        {
          given: 'a contractor whose constitution is not recorded',
          when: 'the payout is prepared',
          then: 'preparation is refused rather than guessing the rate',
        },
      ],
      applies_when_any: [
        'tds',
        'contractor',
        'contract payment',
        'deduction',
        'payout',
        'vendor payment',
        'huf',
      ],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393 table: payments to contractors, 1% for individual or HUF deductees, 2% otherwise.',
      source_conflict_note: null,
    },
    {
      key: 'TDS-005',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'Every deduction records its payment code',
      requirement_text:
        'The payment code under which tax was deducted must be stored against the deduction. ' +
        'The code is what the return is filed on, so a deduction without one cannot be reported.',
      acceptance_criteria: [
        {
          given: 'a completed deduction',
          when: 'it is persisted',
          then: 'the payment code used is stored alongside the rate and the amount',
        },
        {
          given: 'a deduction with no payment code',
          when: 'it is persisted',
          then: 'the write is refused',
        },
      ],
      applies_when_any: ['tds', 'deduction', 'payment code', 'payout', 'return', 'filing'],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393: deductions are reported by payment code in the quarterly statement.',
      source_conflict_note: null,
    },
    {
      key: 'TDS-006',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'The threshold is applied before any deduction is made',
      requirement_text:
        'Deduction applies only once the applicable threshold for the payment category is crossed, ' +
        'assessed on the aggregate for the financial year rather than the single invoice.',
      acceptance_criteria: [
        {
          given: 'aggregate payments to a vendor below the applicable threshold',
          when: 'an invoice is paid',
          then: 'no tax is deducted, and the aggregate is updated',
        },
        {
          given: 'aggregate payments that cross the threshold with the current invoice',
          when: 'that invoice is paid',
          then: 'deduction applies, and the basis recorded shows the aggregate that triggered it',
        },
      ],
      applies_when_any: ['tds', 'threshold', 'deduction', 'payout', 'aggregate', 'vendor payment'],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393 table: per-category thresholds, assessed on the financial-year aggregate.',
      // Disclosed rather than silently resolved. The source document found this
      // disagreement and the report has to carry it.
      source_conflict_note:
        'Sources disagree on the professional and technical services threshold: most give Rs 50,000 with payment codes 1026/1027, one gives Rs 30,000 with codes 1030/1031. This pack encodes Rs 50,000 and 1026/1027. Confirm against the CBDT portal before production use.',
    },
    {
      key: 'TDS-007',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'The deductee PAN is recorded with every deduction',
      requirement_text:
        'A deduction must record the deductee PAN. Where no PAN has been furnished, that fact must ' +
        'be recorded explicitly, because a higher rate applies and the return must reflect it.',
      acceptance_criteria: [
        {
          given: 'a deduction for a deductee with a PAN on record',
          when: 'the deduction is persisted',
          then: 'the PAN is stored against it',
        },
        {
          given: 'a deductee who has furnished no PAN',
          when: 'the payout is prepared',
          then: 'the absence is recorded explicitly and flagged for the higher-rate treatment, not left blank',
        },
      ],
      applies_when_any: ['tds', 'pan', 'deductee', 'deduction', 'payout', 'vendor'],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025: a higher rate applies where PAN is not furnished; the PAN is required in the quarterly statement.',
      source_conflict_note:
        'The higher rate applicable when no PAN is furnished is not encoded here, because the reviewed sources do not state it. Confirm and add before relying on this rule.',
    },
    {
      key: 'TDS-008',
      domain: 'TDS',
      jurisdiction: 'IN',
      severity: 'blocking',
      title: 'A deduction cannot be applied without a resolvable Section 393 row',
      requirement_text:
        'Every deduction must resolve to a specific row of the Section 393 table before it is ' +
        'applied. An unresolved payment category must stop the payout rather than fall back to a ' +
        'default rate.',
      acceptance_criteria: [
        {
          given: 'a payment whose category maps to no Section 393 row',
          when: 'the payout is prepared',
          then: 'preparation is refused and the unmapped category is named',
        },
        {
          given: 'a payment category newly added to the configuration with no mapping',
          when: 'a payout under it is attempted',
          then: 'it is refused rather than deducting at a default rate',
        },
      ],
      applies_when_any: ['tds', 'deduction', 'payout', 'rate', 'section 393', 'vendor payment'],
      superseded_terms: [],
      citation:
        'Income-tax Act 2025, Section 393: the table is exhaustive for the deductions it governs.',
      source_conflict_note: null,
    },
  ],
};

/**
 * The active pack, validated at module load.
 *
 * Validating here means a malformed rule is a startup failure rather than something
 * discovered when an agent is already mid-run.
 */
export const COMPLIANCE_PACK: CompliancePack = CompliancePackSchema.parse(RAW);

export { PACK_VERSION, REVIEWED_ON };
