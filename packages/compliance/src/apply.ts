import { type AcceptanceCriterion, type ComplianceRule, formatId } from '@agentforge/contract';
import { COMPLIANCE_PACK } from './pack.ts';

/**
 * Rule applicability and criteria injection.
 *
 * The pack is useless if every rule attaches to every feature — a reviewer faced with
 * fifteen irrelevant criteria stops reading them, which is worse than having none. So
 * applicability is decided first, by keyword match against the feature's own text, and
 * only matching rules contribute criteria.
 *
 * Keyword matching is deliberately simple and transparent. A model deciding
 * applicability would be unpredictable and unauditable; a reviewer can look at a rule's
 * `applies_when_any` list and see exactly why it fired.
 */

/** Everything a rule's keywords are matched against. */
export interface FeatureText {
  readonly title: string;
  readonly description: string;
  /** Requirement statements and rationales, when requirements already exist. */
  readonly requirementText?: readonly string[];
}

/** Lower-cases and collapses whitespace so matching is not thrown by formatting. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a keyword occurs as a whole word (or phrase) in the haystack.
 *
 * Whole-word matching matters: a substring check would fire the `pan` keyword on the
 * word "company" and attach a PAN rule to a feature that has nothing to do with it.
 */
function containsKeyword(haystack: string, keyword: string): boolean {
  const needle = normalise(keyword);
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;

    const before = at === 0 ? ' ' : haystack[at - 1];
    const after = at + needle.length >= haystack.length ? ' ' : haystack[at + needle.length];
    const isBoundary = (c: string | undefined): boolean => c === undefined || !/[a-z0-9]/.test(c);

    if (isBoundary(before) && isBoundary(after)) return true;
    from = at + 1;
  }
}

/** The rules that apply to a feature, in pack order. */
export function applicableRules(
  feature: FeatureText,
  rules: readonly ComplianceRule[] = COMPLIANCE_PACK.rules,
): readonly ComplianceRule[] {
  const haystack = normalise(
    [feature.title, feature.description, ...(feature.requirementText ?? [])].join(' '),
  );

  return rules.filter((rule) =>
    rule.applies_when_any.some((keyword) => containsKeyword(haystack, keyword)),
  );
}

/** Which keywords caused a rule to fire. Shown in the UI so the match is inspectable. */
export function matchedKeywords(feature: FeatureText, rule: ComplianceRule): readonly string[] {
  const haystack = normalise(
    [feature.title, feature.description, ...(feature.requirementText ?? [])].join(' '),
  );
  return rule.applies_when_any.filter((keyword) => containsKeyword(haystack, keyword));
}

export interface InjectedCriterion extends AcceptanceCriterion {
  /** Always set for an injected criterion: the rule it came from. */
  readonly compliance_rule_key: string;
}

/**
 * Turns applicable rules into acceptance criteria.
 *
 * Ids continue from `startIndex` so injected criteria slot into a requirement's own
 * numbering without colliding. The criteria are copied verbatim from the pack — they
 * are the obligation, and paraphrasing them would break the audit trail back to the
 * citation.
 */
export function injectCriteria(
  rules: readonly ComplianceRule[],
  startIndex: number,
): readonly InjectedCriterion[] {
  const criteria: InjectedCriterion[] = [];
  let next = startIndex;

  for (const rule of rules) {
    for (const template of rule.acceptance_criteria) {
      criteria.push({
        id: formatId('AC', next),
        given: template.given,
        when: template.when,
        then: template.then,
        compliance_rule_key: rule.key,
      });
      next += 1;
    }
  }

  return criteria;
}

/**
 * The pack rendered for a prompt.
 *
 * Deterministic and free of per-request content, so it can sit in the cached prefix.
 * Rules arrive with their criteria already written: the agent's job is to attach the
 * applicable ones, not to invent compliance text.
 */
export function renderPackForPrompt(rules: readonly ComplianceRule[]): string {
  if (rules.length === 0) return '';

  const sections = rules.map((rule) => {
    const criteria = rule.acceptance_criteria
      .map((c, i) => `  ${String(i + 1)}. Given ${c.given}, when ${c.when}, then ${c.then}`)
      .join('\n');

    const conflict =
      rule.source_conflict_note === null
        ? ''
        : `\n- Known source disagreement: ${rule.source_conflict_note}`;

    return [
      `### ${rule.key} — ${rule.title} (${rule.severity})`,
      `- Obligation: ${rule.requirement_text}`,
      `- Citation: ${rule.citation}`,
      `- Acceptance criteria to attach verbatim:`,
      criteria,
      conflict,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  });

  return [
    '## Applicable compliance rules',
    '',
    'Attach each rule that genuinely applies to the requirement it governs: copy its',
    'acceptance criteria verbatim with `compliance_rule_key` set, and add its key to that',
    "requirement's `compliance_refs`. Use the citation exactly as given — do not",
    'substitute a section number or a rate from memory.',
    '',
    ...sections,
  ].join('\n');
}
