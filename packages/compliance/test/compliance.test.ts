import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentForgeError,
  CompliancePackSchema,
  DesignProposalSchema,
  RequirementsProposalSchema,
  TasksProposalSchema,
} from '@agentforge/contract';
import { createDb, type Db } from '@agentforge/db';
import { createSpec, type Actor } from '@agentforge/orchestrator';
import { assertStable } from '@agentforge/llm';
import {
  COMPLIANCE_PACK,
  PACK_VERSION,
  applicableRules,
  blockingViolations,
  buildTraceMatrix,
  compileDetectors,
  detectSupersededTerms,
  ensurePackInstalled,
  injectCriteria,
  installedPackVersion,
  loadPack,
  matchedKeywords,
  readPack,
  readTraces,
  recordTestRef,
  renderPackForPrompt,
  saveTraces,
  unscheduledRules,
  untracedRules,
} from '../src/index.ts';

/**
 * The compliance pack.
 *
 * Two things are being protected. First, the pack's own integrity — a rule with an
 * uncompilable pattern or no criteria would report compliance that was never checked,
 * which is worse than having no pack. Second, the disclosures: the source conflicts are
 * findings the report has to carry, and a test is the only thing stopping them being
 * tidied away in a later edit.
 */

const HUMAN: Actor = { id: 'reviewer@example.com', type: 'human' };

describe('pack integrity', () => {
  it('validates against the contract schema', () => {
    expect(() => CompliancePackSchema.parse(COMPLIANCE_PACK)).not.toThrow();
    expect(COMPLIANCE_PACK.version).toBe(PACK_VERSION);
  });

  it('is capped at fifteen rules, as the plan requires', () => {
    // The cap is a scope-creep defence: compliance content is the easiest place for
    // this project to lose a day.
    expect(COMPLIANCE_PACK.rules).toHaveLength(15);
  });

  it('covers both domains', () => {
    const byDomain = new Map<string, number>();
    for (const rule of COMPLIANCE_PACK.rules) {
      byDomain.set(rule.domain, (byDomain.get(rule.domain) ?? 0) + 1);
    }
    expect(byDomain.get('GST')).toBe(7);
    expect(byDomain.get('TDS')).toBe(8);
  });

  it('has unique, well-formed rule keys', () => {
    const keys = COMPLIANCE_PACK.rules.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^(GST|TDS)-\d{3}$/);
    }
  });

  it('gives every rule at least one criterion and a citation', () => {
    for (const rule of COMPLIANCE_PACK.rules) {
      expect(rule.acceptance_criteria.length, rule.key).toBeGreaterThan(0);
      expect(rule.citation.length, rule.key).toBeGreaterThan(20);
      expect(rule.applies_when_any.length, rule.key).toBeGreaterThan(0);
    }
  });

  it('writes every criterion as a concrete Given/When/Then', () => {
    for (const rule of COMPLIANCE_PACK.rules) {
      for (const criterion of rule.acceptance_criteria) {
        // A criterion nobody could write a test from is not a criterion.
        expect(criterion.given.length, `${rule.key} given`).toBeGreaterThan(10);
        expect(criterion.when.length, `${rule.key} when`).toBeGreaterThan(5);
        expect(criterion.then.length, `${rule.key} then`).toBeGreaterThan(10);
        expect(criterion.given, rule.key).not.toMatch(/^given\b/i);
      }
    }
  });

  it('compiles every superseded-term pattern', () => {
    // An invalid pattern silently matches nothing, so this must be a hard failure.
    expect(() => compileDetectors()).not.toThrow();
    expect(compileDetectors().length).toBeGreaterThan(0);
  });

  it('rejects a rule whose pattern does not compile', () => {
    const broken = COMPLIANCE_PACK.rules.map((rule) =>
      rule.key === 'TDS-001'
        ? {
            ...rule,
            superseded_terms: [{ pattern: '(unclosed', replacement: 'x', explanation: 'y' }],
          }
        : rule,
    );

    try {
      compileDetectors(broken);
      throw new Error('expected an invalid pattern to be rejected');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('disclosures that must not be quietly removed', () => {
  it('discloses the TDS threshold and payment-code conflict', () => {
    // Sources disagree (Rs 50,000 with codes 1026/1027 versus Rs 30,000 with
    // 1030/1031). The pack picks one and says so; the report depends on this note.
    const rule = COMPLIANCE_PACK.rules.find((r) => r.key === 'TDS-006');
    expect(rule?.source_conflict_note).toMatch(/50,000/);
    expect(rule?.source_conflict_note).toMatch(/30,000/);
    expect(rule?.source_conflict_note).toMatch(/1026|1027/);
  });

  it('records that the no-PAN higher rate is deliberately not encoded', () => {
    // Encoding a rate the reviewed sources do not state would be fabrication in a tool
    // whose whole claim is verifiable compliance.
    const rule = COMPLIANCE_PACK.rules.find((r) => r.key === 'TDS-007');
    expect(rule?.source_conflict_note).toMatch(/not encoded here/);
  });

  it('marks every rate-bearing rule as needing confirmation', () => {
    for (const key of ['TDS-002', 'TDS-003']) {
      const rule = COMPLIANCE_PACK.rules.find((r) => r.key === key);
      expect(rule?.source_conflict_note, key).toMatch(/confirmed against the CBDT portal/);
    }
  });
});

describe('superseded-term detection', () => {
  const scan = (text: string) => detectSupersededTerms([{ location: 'design.body', text }]);

  it('catches Section 194J and names the Section 393 replacement', () => {
    // The headline demo: a design that reads perfectly but cites dissolved law.
    const violations = scan('Deduct TDS under Section 194J for consultant invoices.');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule_key).toBe('TDS-001');
    expect(violations[0]?.matched_text).toBe('Section 194J');
    expect(violations[0]?.replacement).toContain('Section 393');
    expect(violations[0]?.severity).toBe('blocking');
    expect(violations[0]?.location).toBe('design.body');
  });

  it.each([
    ['Section 194C', 'contractors'],
    ['Section 194I', 'rent'],
  ])('catches %s and maps it to the right Section 393 row', (term, expected) => {
    const violations = scan(`Apply ${term} to this payment.`);
    expect(violations[0]?.replacement).toContain(expected);
  });

  it('is case- and spacing-insensitive', () => {
    for (const variant of ['section 194j', 'SECTION 194J', 'Section  194J', 'section 194-J']) {
      const violations = scan(`Use ${variant} here.`);
      expect(violations.length, variant).toBeGreaterThan(0);
      expect(violations[0]?.rule_key, variant).toBe('TDS-001');
    }
  });

  it('reports one finding per phrase, not one per matching pattern', () => {
    // The pack has a specific 194J rule and a catch-all for the rest of the series;
    // overlapping matches must not produce two findings for the same words.
    const violations = scan('Section 194J applies.');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.replacement).toContain('professional services');
  });

  it('catches a 194-series section with no specific rule via the catch-all', () => {
    const violations = scan('Deduct under Section 194H for brokerage.');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.replacement).toContain('corresponding Section 393');
  });

  it('finds every occurrence across several locations', () => {
    const violations = detectSupersededTerms([
      { location: 'requirements[0].rationale', text: 'As required by Section 194J.' },
      { location: 'design.sections[1].body', text: 'Section 194C governs this.' },
      { location: 'design.sections[2].body', text: 'No statutory reference here.' },
    ]);

    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.location)).toEqual([
      'requirements[0].rationale',
      'design.sections[1].body',
    ]);
  });

  it('does not flag correct current law', () => {
    const violations = scan(
      'Deduct under the Section 393 table of the Income-tax Act 2025, payment code 1027.',
    );
    expect(violations).toEqual([]);
  });

  it('does not flag unrelated numbers that merely look similar', () => {
    expect(scan('Invoice 194J-00123 was issued.')).toEqual([]);
    expect(scan('Rule 194 of some other instrument.')).toEqual([]);
  });

  it('reports blocking violations separately', () => {
    const violations = scan('Section 194J applies.');
    expect(blockingViolations(violations)).toHaveLength(1);
    expect(blockingViolations([])).toEqual([]);
  });
});

describe('a mention that is about the section being dissolved', () => {
  /*
   * Found by running the pipeline against a live model, which no stub could have done.
   *
   * The pack's own acceptance criterion says a deduction configured against Section 194J
   * must be rejected and the Section 393 equivalent named, so every correct design has to
   * write the words "Section 194J". The guard blocked any text containing them. Two live
   * runs on two different models — Haiku and Sonnet — produced correct designs and were
   * refused for exactly that. The sentences below are the ones those models actually wrote.
   */
  const scan = (text: string) => detectSupersededTerms([{ location: 'design.body', text }]);
  const blocking = (text: string) => blockingViolations(scan(text));

  it.each([
    // Sonnet 5.5, design section "Section 393 row registry and legacy 194-series rejection".
    'The row list comes from the legacy_equivalent_of mapping, so a deduction configured against Section 194J is rejected and the equivalent row is named (AC-010).',
    // Haiku 5.5, design section "TDS rate configuration and rejection of 194-series citations".
    'The validator returns an error that names the Section 393 professional-services row as the equivalent of Section 194J (REQ-001, TDS-001 AC-001).',
  ])('does not block what the live models actually wrote: %s', (sentence) => {
    expect(blocking(sentence)).toEqual([]);
    // But it is still *seen*: a reviewer looking at the trace should not lose it.
    expect(scan(sentence).length).toBeGreaterThan(0);
  });

  it('reports a qualifying mention as advisory, not as nothing', () => {
    const [violation] = scan('A deduction configured against Section 194J is rejected.');

    expect(violation?.severity).toBe('advisory');
    expect(violation?.explanation).toContain('does not block');
    expect(violation?.matched_text).toBe('Section 194J');
  });

  it('accepts a sentence that names Section 393 as the replacement', () => {
    expect(blocking('Section 194J is now Section 393 in the Income-tax Act 2025.')).toEqual([]);
  });

  it('accepts a sentence that says the section is legacy, dissolved or superseded', () => {
    for (const sentence of [
      'Section 194J is a legacy provision and is not used.',
      'Section 194J no longer exists.',
      'Section 194J was dissolved by the 2025 Act.',
      'Section 194J has been superseded.',
    ]) {
      expect(blocking(sentence), sentence).toEqual([]);
    }
  });

  it('still blocks a bare citation, which is the whole point of the guard', () => {
    for (const sentence of [
      'Deduct TDS under Section 194J for consultant invoices.',
      'Section 194J applies to professional fees.',
      'The rate is set by Section 194J.',
    ]) {
      expect(blocking(sentence).length, sentence).toBe(1);
    }
  });

  it('does not let a neighbouring sentence excuse a bare citation', () => {
    // The reason the rule is per sentence and not per paragraph. A wider window would let
    // an unrelated mention of Section 393 two sentences away launder a wrong citation.
    expect(
      blocking('Deduct TDS under Section 194J. The Section 393 table is described elsewhere.'),
    ).toHaveLength(1);
  });

  it('does not let a neighbouring line excuse a bare citation either', () => {
    expect(
      blocking('Section 194J applies to consultants.\nThe legacy system is out of scope.'),
    ).toHaveLength(1);
  });

  it('judges each mention on its own, in the same text', () => {
    const text =
      'A deduction against Section 194J is rejected. Separately, deduct under Section 194C for contractors.';

    const all = scan(text);
    expect(all).toHaveLength(2);
    expect(all.map((v) => v.severity)).toEqual(['advisory', 'blocking']);
    expect(blockingViolations(all)).toHaveLength(1);
  });

  it('documents a known limit rather than hiding it', () => {
    // KNOWN LIMIT. This is a heuristic, and a sentence written to pass it will. The
    // human approval gate is the control that catches this, not the lint. It is asserted
    // here so nobody mistakes the guard for a guarantee — if this ever starts blocking,
    // the rule has changed and the documentation must change with it.
    expect(blocking('Section 194J applies to professional fees (see Section 393).')).toEqual([]);
  });
});

describe('applicability', () => {
  it('attaches TDS rules to a payout feature', () => {
    const rules = applicableRules({
      title: 'Add TDS deduction to vendor payouts',
      description: 'Deduct tax at the Section 393 rate when paying a vendor.',
    });

    const keys = rules.map((r) => r.key);
    expect(keys).toContain('TDS-001');
    expect(keys).toContain('TDS-004');
    // A payout feature has nothing to do with invoice numbering.
    expect(keys).not.toContain('GST-003');
  });

  it('attaches GST rules to an invoicing feature', () => {
    const rules = applicableRules({
      title: 'GST invoice export',
      description: 'Export a finalised invoice as e-invoice JSON with HSN codes.',
    });

    const keys = rules.map((r) => r.key);
    expect(keys).toContain('GST-001');
    expect(keys).toContain('GST-005');
  });

  it('attaches nothing to a feature that touches neither domain', () => {
    // A reviewer shown fifteen irrelevant criteria stops reading them, which is worse
    // than showing none.
    const rules = applicableRules({
      title: 'Dark mode toggle',
      description: 'Let a user switch the interface between light and dark themes.',
    });
    expect(rules).toEqual([]);
  });

  it('matches whole words only', () => {
    // A substring check would fire the `pan` keyword on "company" and attach a PAN rule
    // to a feature with nothing to do with it.
    const rules = applicableRules({
      title: 'Company profile page',
      description: 'Show the company name and expand the panel on click.',
    });
    expect(rules.map((r) => r.key)).not.toContain('TDS-007');
  });

  it('reports which keywords caused a match, so the decision is inspectable', () => {
    const feature = {
      title: 'Vendor payout TDS',
      description: 'Compute the deduction for each vendor payment.',
    };
    const rule = COMPLIANCE_PACK.rules.find((r) => r.key === 'TDS-005');
    if (rule === undefined) throw new Error('expected TDS-005');

    const matched = matchedKeywords(feature, rule);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched).toContain('tds');
  });

  it('considers requirement text as well as the description', () => {
    const rules = applicableRules({
      title: 'Payments module',
      description: 'Pay people.',
      requirementText: ['The system shall deduct TDS on professional fees.'],
    });
    expect(rules.map((r) => r.key)).toContain('TDS-002');
  });
});

describe('criteria injection', () => {
  it('numbers injected criteria continuing from the given index', () => {
    const rules = COMPLIANCE_PACK.rules.filter((r) => r.key === 'GST-003');
    const injected = injectCriteria(rules, 4);

    expect(injected[0]?.id).toBe('AC-004');
    expect(injected[1]?.id).toBe('AC-005');
    expect(injected.every((c) => c.compliance_rule_key === 'GST-003')).toBe(true);
  });

  it('copies the criteria verbatim from the pack', () => {
    const rule = COMPLIANCE_PACK.rules.find((r) => r.key === 'TDS-002');
    if (rule === undefined) throw new Error('expected TDS-002');

    const injected = injectCriteria([rule], 1);
    // Paraphrasing would break the audit trail back to the citation.
    expect(injected[0]?.given).toBe(rule.acceptance_criteria[0]?.given);
    expect(injected[0]?.then).toBe(rule.acceptance_criteria[0]?.then);
  });

  it('injects nothing for no rules', () => {
    expect(injectCriteria([], 1)).toEqual([]);
  });
});

describe('prompt rendering', () => {
  it('is cacheable: no per-request content', () => {
    const rendered = renderPackForPrompt(COMPLIANCE_PACK.rules);
    // The pack sits in the cached prefix, so a date or id in it would invalidate the
    // cache on every request.
    expect(() => {
      assertStable({ name: 'compliance-pack', text: rendered, stable: true });
    }).not.toThrow();
  });

  it('is deterministic', () => {
    expect(renderPackForPrompt(COMPLIANCE_PACK.rules)).toBe(
      renderPackForPrompt(COMPLIANCE_PACK.rules),
    );
  });

  it('includes the citation and the criteria the agent must copy', () => {
    const rule = COMPLIANCE_PACK.rules.filter((r) => r.key === 'TDS-003');
    const rendered = renderPackForPrompt(rule);

    expect(rendered).toContain('TDS-003');
    expect(rendered).toContain('payment code 1026');
    expect(rendered).toContain('Acceptance criteria to attach verbatim');
    expect(rendered).toContain('do not');
  });

  it('surfaces a source conflict to the agent', () => {
    const rule = COMPLIANCE_PACK.rules.filter((r) => r.key === 'TDS-006');
    expect(renderPackForPrompt(rule)).toContain('Known source disagreement');
  });

  it('renders nothing when no rules apply', () => {
    expect(renderPackForPrompt([])).toBe('');
  });
});

describe('trace matrix', () => {
  const rules = COMPLIANCE_PACK.rules.filter((r) => r.key === 'GST-003');

  const requirements = RequirementsProposalSchema.parse({
    feature_summary: 'Gap-free invoice numbering.',
    requirements: [
      {
        id: 'REQ-001',
        ears_pattern: 'event_driven',
        ears_statement:
          'When an invoice is finalised, the system shall assign the next number in the series.',
        rationale: 'GST requires a consecutive series.',
        priority: 'must',
        acceptance_criteria: [
          {
            id: 'AC-001',
            given: 'the last invoice of the year is numbered 41',
            when: 'another is finalised',
            then: 'it is numbered 42',
            compliance_rule_key: 'GST-003',
          },
        ],
        source_refs: [],
        compliance_refs: ['GST-003'],
      },
    ],
    clarification_questions: [],
    non_goals: [],
  });

  const design = DesignProposalSchema.parse({
    overview: 'A per-series counter.',
    sections: [
      {
        id: 'DES-001',
        heading: 'Series counter',
        body: 'One row per financial year, incremented transactionally.',
        source_refs: [],
        requirement_ids: ['REQ-001'],
      },
    ],
    decisions: [],
    risks: [],
  });

  const tasks = TasksProposalSchema.parse({
    implementation_order_rationale: 'Counter first.',
    tasks: [
      {
        id: 'TASK-001',
        title: 'Add the counter table',
        description: 'Migration plus allocate().',
        status: 'pending',
        requirement_ids: ['REQ-001'],
        design_section_ids: ['DES-001'],
        source_refs: [],
        verifies: ['AC-001'],
        depends_on: [],
      },
    ],
  });

  it('traces a rule all the way to a task', () => {
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks,
      violations: [],
    });

    expect(coverage.applicable_rules).toBe(1);
    expect(coverage.traced_to_requirement).toBe(1);
    expect(coverage.traced_to_design).toBe(1);
    expect(coverage.traced_to_task).toBe(1);
    expect(coverage.traced_to_test).toBe(0);
    expect(coverage.coverage_rate).toBe(1);

    const trace = coverage.traces[0];
    expect(trace).toMatchObject({
      rule_key: 'GST-003',
      requirement_id: 'REQ-001',
      acceptance_criterion_id: 'AC-001',
      design_section_id: 'DES-001',
      task_id: 'TASK-001',
      test_ref: null,
    });
  });

  it('records a test reference when one is supplied', () => {
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks,
      violations: [],
      testRefs: new Map([['AC-001', 'invoice.test.ts > numbers consecutively']]),
    });

    expect(coverage.traced_to_test).toBe(1);
    expect(coverage.traces[0]?.test_ref).toContain('invoice.test.ts');
  });

  it('surfaces an applicable rule that nothing references', () => {
    // The most important gap: the rule applies and was simply not addressed.
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: COMPLIANCE_PACK.rules.filter((r) => r.key === 'GST-001'),
      requirements,
      design,
      tasks,
      violations: [],
    });

    expect(coverage.applicable_rules).toBe(1);
    expect(coverage.traced_to_requirement).toBe(0);
    expect(coverage.coverage_rate).toBe(0);
    expect(coverage.traces[0]?.requirement_id).toBeNull();
    expect(untracedRules(coverage)).toEqual(['GST-001']);
  });

  it('distinguishes a rule written down from one actually scheduled', () => {
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks: null,
      violations: [],
    });

    expect(coverage.traced_to_requirement).toBe(1);
    expect(coverage.traced_to_task).toBe(0);
    expect(coverage.coverage_rate).toBe(0);
    expect(unscheduledRules(coverage)).toEqual(['GST-003']);
  });

  it('falls back to a task covering the requirement when none names the criterion', () => {
    const vaguer = TasksProposalSchema.parse({
      ...tasks,
      tasks: [{ ...tasks.tasks[0], verifies: [] }],
    });

    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks: vaguer,
      violations: [],
    });

    // Weaker than a direct criterion link, but the work is still scheduled.
    expect(coverage.traced_to_task).toBe(1);
    expect(coverage.traces[0]?.task_id).toBe('TASK-001');
  });

  it('counts coverage per rule, not per criterion row', () => {
    // GST-003 has four criteria in the pack; a rule reaching a task is one rule
    // covered, not four.
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks,
      violations: [],
    });
    expect(coverage.applicable_rules).toBe(1);
    expect(coverage.traced_to_task).toBeLessThanOrEqual(1);
  });

  it('reports zero coverage for no applicable rules without dividing by zero', () => {
    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: [],
      requirements: null,
      design: null,
      tasks: null,
      violations: [],
    });

    expect(coverage.applicable_rules).toBe(0);
    expect(coverage.coverage_rate).toBe(0);
    expect(coverage.traces).toEqual([]);
  });

  it('carries violations through onto the coverage report', () => {
    const violations = detectSupersededTerms([
      { location: 'design.sections[0].body', text: 'Section 194J applies.' },
    ]);

    const coverage = buildTraceMatrix({
      packVersion: PACK_VERSION,
      applicableRules: rules,
      requirements,
      design,
      tasks,
      violations,
    });

    expect(coverage.violations).toHaveLength(1);
    expect(coverage.violations[0]?.rule_key).toBe('TDS-001');
  });
});

describe('persistence', () => {
  let dir: string;
  let db: Db;
  let specId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentforge-compliance-'));
    db = createDb(join(dir, 'c.db'));
    specId = createSpec(db, {
      title: 'GST invoice export',
      description: 'Export invoices.',
      mode: 'greenfield',
      repo_path: null,
      actor: HUMAN,
    }).id;
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports no pack before one is loaded', () => {
    expect(installedPackVersion(db)).toBeUndefined();
    try {
      readPack(db);
      throw new Error('expected NOT_FOUND');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('NOT_FOUND');
    }
  });

  it('loads the pack and reads it back intact', () => {
    expect(loadPack(db)).toBe(15);
    expect(installedPackVersion(db)).toBe(PACK_VERSION);

    const stored = readPack(db);
    expect(stored.version).toBe(PACK_VERSION);
    expect(stored.rules).toHaveLength(15);

    // The stored rule must be the rule, not a lossy copy: an approval records the pack
    // version, so the exact text in force then has to be recoverable.
    const tds001 = stored.rules.find((r) => r.key === 'TDS-001');
    const source = COMPLIANCE_PACK.rules.find((r) => r.key === 'TDS-001');
    expect(tds001).toEqual(source);
  });

  describe('ensurePackInstalled', () => {
    // loadPack had exactly one caller outside the tests: the seed script, which loads
    // *fixtures*. A real install runs db:migrate and never db:seed, so it had no pack, the
    // Task Agent skipped the trace, and the trace route returned an empty rule list.
    // Nothing failed. These pin the fix.
    it('installs the pack into a database that never ran the seed', () => {
      expect(installedPackVersion(db)).toBeUndefined();

      ensurePackInstalled(db);

      expect(installedPackVersion(db)).toBe(PACK_VERSION);
      expect(readPack(db).rules).toHaveLength(15);
    });

    it('does nothing when the current pack is already there', () => {
      loadPack(db);

      // loadPack reports how many rules it inserted, so a second call returning 0 shows
      // the helper did not reinstall anything.
      ensurePackInstalled(db);
      expect(loadPack(db)).toBe(0);
    });

    it('is safe to call repeatedly', () => {
      for (let i = 0; i < 3; i += 1) ensurePackInstalled(db);

      expect(readPack(db).rules).toHaveLength(15);
    });

    it('installs a newer pack alongside an older one rather than refusing', () => {
      loadPack(db, { ...COMPLIANCE_PACK, version: '0.9.0' });
      expect(installedPackVersion(db)).toBe('0.9.0');

      ensurePackInstalled(db);

      // The older version stays: an approval records the pack version it was granted
      // under, so the rule text in force then has to remain recoverable.
      expect(installedPackVersion(db)).toBe(PACK_VERSION);
      expect(readPack(db, '0.9.0').rules).toHaveLength(15);
    });
  });

  it('is idempotent', () => {
    loadPack(db);
    expect(loadPack(db)).toBe(0);
    expect(readPack(db).rules).toHaveLength(15);
  });

  it('404s for a version that is not installed', () => {
    loadPack(db);
    expect(() => readPack(db, '9.9.9')).toThrow(/not installed/);
  });

  it('saves and reads trace rows', () => {
    loadPack(db);
    const traces = [
      {
        rule_key: 'GST-003',
        requirement_id: 'REQ-001',
        acceptance_criterion_id: 'AC-001',
        design_section_id: 'DES-001',
        task_id: 'TASK-001',
        test_ref: null,
      },
    ];

    expect(saveTraces(db, specId, PACK_VERSION, traces)).toBe(1);
    expect(readTraces(db, specId)).toEqual(traces);
  });

  it('replaces a spec’s traces rather than accumulating them', () => {
    loadPack(db);
    const base = {
      rule_key: 'GST-003',
      requirement_id: 'REQ-001',
      acceptance_criterion_id: 'AC-001',
      design_section_id: null,
      task_id: null,
      test_ref: null,
    };

    saveTraces(db, specId, PACK_VERSION, [base]);
    saveTraces(db, specId, PACK_VERSION, [{ ...base, task_id: 'TASK-001' }]);

    const stored = readTraces(db, specId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.task_id).toBe('TASK-001');
  });

  it('records a test reference against a criterion', () => {
    loadPack(db);
    saveTraces(db, specId, PACK_VERSION, [
      {
        rule_key: 'GST-003',
        requirement_id: 'REQ-001',
        acceptance_criterion_id: 'AC-001',
        design_section_id: 'DES-001',
        task_id: 'TASK-001',
        test_ref: null,
      },
    ]);

    expect(recordTestRef(db, specId, 'AC-001', 'invoice.test.ts > numbers consecutively')).toBe(1);
    expect(readTraces(db, specId)[0]?.test_ref).toContain('invoice.test.ts');
  });

  it('records nothing for an unknown criterion', () => {
    loadPack(db);
    expect(recordTestRef(db, specId, 'AC-999', 'somewhere.test.ts')).toBe(0);
  });
});
