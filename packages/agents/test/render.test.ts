import { describe, expect, it } from 'vitest';
import {
  type DesignProposal,
  DesignProposalSchema,
  type RequirementsProposal,
  RequirementsProposalSchema,
  type TasksProposal,
  TasksProposalSchema,
} from '@agentforge/contract';
import { contentHashOf } from '@agentforge/db';
import { renderDesign, renderRequirements, renderTasks } from '../src/index.ts';

/**
 * Golden-file tests for the renderers.
 *
 * Two properties matter:
 *
 * 1. **Exactness.** The full document is asserted, not a substring, so a stray heading
 *    change or a dropped traceability id fails the build rather than quietly altering a
 *    document somebody already approved.
 * 2. **Determinism.** Rendering twice must produce identical bytes. A renderer that
 *    consulted the clock or iterated a Set would break the content-hash contract.
 *
 * The fixtures are validated against the real schemas first, so a golden file can never
 * encode a shape the system would actually reject.
 */

const requirements: RequirementsProposal = RequirementsProposalSchema.parse({
  feature_summary: 'Let an SMB export a finalised invoice as GST e-invoice JSON.',
  requirements: [
    {
      id: 'REQ-001',
      ears_pattern: 'event_driven',
      ears_statement:
        'When a user exports a finalised invoice, the system shall produce GST e-invoice JSON.',
      rationale: 'Required before the invoice can be uploaded to the IRP.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-001',
          given: 'a finalised invoice with a registered buyer',
          when: 'the user exports it',
          then: 'every mandatory GST field is present',
          compliance_rule_key: 'GST-001',
        },
        {
          id: 'AC-002',
          given: 'an invoice missing the buyer GSTIN',
          when: 'the user exports it',
          then: 'the export is refused with a field-level error',
          compliance_rule_key: null,
        },
      ],
      source_refs: [
        {
          file: 'src/billing/invoice.ts',
          line_start: 42,
          line_end: 88,
          symbol: 'finaliseInvoice',
          evidence_id: 'EV-001',
        },
      ],
      compliance_refs: ['GST-001'],
    },
    {
      id: 'REQ-002',
      ears_pattern: 'unwanted_behaviour',
      ears_statement:
        'If the TDS section cited is from the 1961 Act, then the system shall refuse the export.',
      rationale: 'The 194-series was replaced by Section 393 on 1 April 2026.',
      priority: 'must',
      acceptance_criteria: [
        {
          id: 'AC-003',
          given: 'a deduction citing Section 194J',
          when: 'the invoice is exported',
          then: 'the export is refused and Section 393 is suggested',
          compliance_rule_key: 'TDS-001',
        },
      ],
      source_refs: [],
      compliance_refs: ['TDS-001'],
    },
  ],
  clarification_questions: [],
  non_goals: ['Live IRP submission', 'Credit and debit notes'],
});

const design: DesignProposal = DesignProposalSchema.parse({
  overview: 'A pure serialiser plus a field validator, wired into the existing export route.',
  sections: [
    {
      id: 'DES-001',
      heading: 'GST payload serialiser',
      body: 'Map the internal invoice model onto the GST schema. Pure and unit-testable.',
      source_refs: [
        {
          file: 'src/billing/invoice.ts',
          line_start: 42,
          line_end: 88,
          symbol: 'finaliseInvoice',
          evidence_id: 'EV-001',
        },
        {
          file: 'src/billing/export.ts',
          line_start: 10,
          line_end: 10,
          symbol: null,
          evidence_id: null,
        },
      ],
      requirement_ids: ['REQ-001'],
    },
    {
      id: 'DES-002',
      heading: 'Superseded-section guard',
      body: 'Reject 1961-Act section citations and map them to the Income-tax Act 2025.',
      source_refs: [],
      requirement_ids: ['REQ-002'],
    },
  ],
  decisions: [
    {
      id: 'ADR-001',
      decision: 'Validate before serialising.',
      rationale: 'A partial payload is never written, so a failed export leaves no artefact.',
      alternatives_considered: ['Serialise then validate', 'Validate inside the IRP client'],
    },
  ],
  risks: ['The published GST schema may change before submission is implemented.'],
});

const tasks: TasksProposal = TasksProposalSchema.parse({
  implementation_order_rationale:
    'The validator lands first so the serialiser can be tested against real rejections.',
  tasks: [
    {
      id: 'TASK-001',
      title: 'Add mandatory-field validator',
      description: 'Validate the mandatory GST field set and return field-level errors.',
      status: 'pending',
      requirement_ids: ['REQ-001'],
      design_section_ids: ['DES-001'],
      source_refs: [],
      verifies: ['AC-001', 'AC-002'],
      depends_on: [],
    },
    {
      id: 'TASK-002',
      title: 'Add superseded-section guard',
      description: 'Refuse 1961-Act citations and suggest the Section 393 equivalent.',
      status: 'pending',
      requirement_ids: ['REQ-002'],
      design_section_ids: ['DES-002'],
      source_refs: [
        {
          file: 'src/tax/tds.ts',
          line_start: 5,
          line_end: 30,
          symbol: 'resolveSection',
          evidence_id: 'EV-004',
        },
      ],
      verifies: ['AC-003'],
      depends_on: ['TASK-001'],
    },
  ],
});

const TITLE = 'GST invoice export';

describe('renderRequirements', () => {
  const md = renderRequirements(TITLE, requirements);

  it('renders the exact expected document', () => {
    expect(md).toBe(`# Requirements: ${TITLE}

Let an SMB export a finalised invoice as GST e-invoice JSON.

## Non-goals

- Live IRP submission
- Credit and debit notes

## Requirements

### REQ-001 — Event-driven

**Statement.** When a user exports a finalised invoice, the system shall produce GST e-invoice JSON.

**Rationale.** Required before the invoice can be uploaded to the IRP.

**Priority.** must

#### Acceptance criteria

| ID | Given | When | Then | Compliance |
| --- | --- | --- | --- | --- |
| AC-001 | a finalised invoice with a registered buyer | the user exports it | every mandatory GST field is present | GST-001 |
| AC-002 | an invoice missing the buyer GSTIN | the user exports it | the export is refused with a field-level error | — |

#### Evidence

- \`src/billing/invoice.ts:42-88\` (\`finaliseInvoice\`) [EV-001]

**Compliance rules.** GST-001

### REQ-002 — Unwanted behaviour

**Statement.** If the TDS section cited is from the 1961 Act, then the system shall refuse the export.

**Rationale.** The 194-series was replaced by Section 393 on 1 April 2026.

**Priority.** must

#### Acceptance criteria

| ID | Given | When | Then | Compliance |
| --- | --- | --- | --- | --- |
| AC-003 | a deduction citing Section 194J | the invoice is exported | the export is refused and Section 393 is suggested | TDS-001 |

**Compliance rules.** TDS-001

## Traceability index

| Requirement | Priority | Criteria | Evidence | Compliance |
| --- | --- | --- | --- | --- |
| REQ-001 | must | 2 | 1 | GST-001 |
| REQ-002 | must | 1 | 0 | TDS-001 |
`);
  });

  it('is deterministic across renders', () => {
    expect(renderRequirements(TITLE, requirements)).toBe(md);
  });

  it('renders open questions instead of requirements when the agent is still asking', () => {
    const asking = RequirementsProposalSchema.parse({
      feature_summary: 'Unclear scope.',
      requirements: [],
      clarification_questions: [
        {
          question: 'Should credit notes be included?',
          why_it_matters: 'It doubles the mandatory field set.',
          options: ['Yes', 'No'],
        },
      ],
      non_goals: [],
    });

    const out = renderRequirements(TITLE, asking);
    expect(out).toContain('## Open questions');
    expect(out).toContain('Should credit notes be included?');
    expect(out).toContain('None proposed yet');
    // No traceability index when there is nothing to trace.
    expect(out).not.toContain('## Traceability index');
  });

  it('escapes a pipe so it cannot break out of a table cell', () => {
    const risky = RequirementsProposalSchema.parse({
      ...requirements,
      requirements: [
        {
          ...requirements.requirements[0],
          acceptance_criteria: [
            {
              id: 'AC-001',
              given: 'a | b',
              when: 'c | d',
              then: 'e | f',
              compliance_rule_key: null,
            },
          ],
        },
      ],
    });

    const out = renderRequirements(TITLE, risky);
    expect(out).toContain('| AC-001 | a \\| b | c \\| d | e \\| f | — |');
  });

  it('flattens a newline inside a table cell', () => {
    const multiline = RequirementsProposalSchema.parse({
      ...requirements,
      requirements: [
        {
          ...requirements.requirements[0],
          acceptance_criteria: [
            {
              id: 'AC-001',
              given: 'line one\nline two',
              when: 'w',
              then: 't',
              compliance_rule_key: null,
            },
          ],
        },
      ],
    });

    const out = renderRequirements(TITLE, multiline);
    expect(out).toContain('| AC-001 | line one line two | w | t | — |');
  });
});

describe('renderDesign', () => {
  const md = renderDesign(TITLE, design);

  it('renders the exact expected document', () => {
    expect(md).toBe(`# Design: ${TITLE}

A pure serialiser plus a field validator, wired into the existing export route.

## Sections

### DES-001 — GST payload serialiser

Map the internal invoice model onto the GST schema. Pure and unit-testable.

**Implements.** REQ-001

**Evidence.**

- \`src/billing/invoice.ts:42-88\` (\`finaliseInvoice\`) [EV-001]
- \`src/billing/export.ts:10\`

### DES-002 — Superseded-section guard

Reject 1961-Act section citations and map them to the Income-tax Act 2025.

**Implements.** REQ-002

## Decisions

### ADR-001

**Decision.** Validate before serialising.

**Rationale.** A partial payload is never written, so a failed export leaves no artefact.

**Alternatives considered.** Serialise then validate, Validate inside the IRP client

## Risks

- The published GST schema may change before submission is implemented.

## Requirement coverage

| Section | Heading | Requirements | Evidence refs |
| --- | --- | --- | --- |
| DES-001 | GST payload serialiser | REQ-001 | 2 |
| DES-002 | Superseded-section guard | REQ-002 | 0 |
`);
  });

  it('is deterministic across renders', () => {
    expect(renderDesign(TITLE, design)).toBe(md);
  });

  it('renders a single-line source ref without a range', () => {
    expect(md).toContain('`src/billing/export.ts:10`');
    expect(md).not.toContain('export.ts:10-10');
  });
});

describe('renderTasks', () => {
  const md = renderTasks(TITLE, tasks);

  it('renders the exact expected document', () => {
    expect(md).toBe(`# Tasks: ${TITLE}

**Implementation order.** The validator lands first so the serialiser can be tested against real rejections.

## Tasks

### TASK-001 — Add mandatory-field validator

Validate the mandatory GST field set and return field-level errors.

- **Status.** pending
- **Implements.** REQ-001
- **Design sections.** DES-001
- **Verifies.** AC-001, AC-002
- **Depends on.** —

### TASK-002 — Add superseded-section guard

Refuse 1961-Act citations and suggest the Section 393 equivalent.

- **Status.** pending
- **Implements.** REQ-002
- **Design sections.** DES-002
- **Verifies.** AC-003
- **Depends on.** TASK-001

**Evidence.**

- \`src/tax/tds.ts:5-30\` (\`resolveSection\`) [EV-004]

## Task index

| Task | Title | Status | Implements | Verifies | Depends on |
| --- | --- | --- | --- | --- | --- |
| TASK-001 | Add mandatory-field validator | pending | REQ-001 | AC-001, AC-002 | — |
| TASK-002 | Add superseded-section guard | pending | REQ-002 | AC-003 | TASK-001 |
`);
  });

  it('is deterministic across renders', () => {
    expect(renderTasks(TITLE, tasks)).toBe(md);
  });
});

describe('rendering and hashing interact correctly', () => {
  it('leaves the content hash unchanged when only key order differs', () => {
    // The hash covers the payload, not the markdown, so a reordered-but-equal payload
    // must hash the same and therefore keep an existing approval valid.
    const reordered = {
      non_goals: requirements.non_goals,
      clarification_questions: requirements.clarification_questions,
      requirements: requirements.requirements,
      feature_summary: requirements.feature_summary,
    };
    expect(contentHashOf(reordered)).toBe(contentHashOf(requirements));
    expect(renderRequirements(TITLE, RequirementsProposalSchema.parse(reordered))).toBe(
      renderRequirements(TITLE, requirements),
    );
  });

  it('changes the content hash when any field changes', () => {
    const edited = { ...requirements, feature_summary: 'Slightly different.' };
    expect(contentHashOf(edited)).not.toBe(contentHashOf(requirements));
  });
});
