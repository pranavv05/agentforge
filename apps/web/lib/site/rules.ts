import { COMPLIANCE_PACK, PACK_VERSION } from '@agentforge/compliance';

/**
 * The compliance pack, shaped for the marketing pages.
 *
 * The pages arrived with their own hand-written copy of the rules. That copy would have
 * drifted the first time the real pack changed, and a marketing page quoting a rule
 * count the product does not have is exactly the kind of claim this project is supposed
 * to be able to defend. So the pages now read the shipped pack: the rule count, the
 * version and every quoted criterion on the site are the same bytes the agents inject.
 *
 * This is only a rename. Nothing here invents a field the pack does not have, and where
 * the pack carries something the pages never displayed — a severity, a citation, a
 * recorded source disagreement — it is left alone rather than flattened into prose.
 */
export interface SiteRule {
  readonly id: string;
  readonly title: string;
  readonly family: string;
  readonly triggers: readonly string[];
  /** The obligation, as the EARS statement the injector writes. */
  readonly ears: string;
  /** One worked Given/When/Then, so a reader sees a criterion rather than a promise. */
  readonly criterion: string;
  /**
   * A recorded disagreement between sources, or null.
   *
   * The pack keeps these rather than resolving them quietly, and tests assert they stay
   * put, so the site shows them too. A compliance page that looked more certain than
   * the pack behind it would be the wrong kind of polish.
   */
  readonly note: string | null;
}

export { PACK_VERSION };

export const RULES: readonly SiteRule[] = COMPLIANCE_PACK.rules.map((rule) => {
  const first = rule.acceptance_criteria[0];

  return {
    id: rule.key,
    title: rule.title,
    family: rule.domain,
    triggers: rule.applies_when_any,
    ears: rule.requirement_text,
    criterion:
      first === undefined
        ? // Every rule in the shipped pack has at least one criterion, and a test asserts
          // it. Saying so plainly beats rendering "undefined" if that ever stops holding.
          'This rule carries no worked criterion in the current pack.'
        : `Given ${first.given}, when ${first.when}, then ${first.then}.`,
    note: rule.source_conflict_note,
  };
});

/** Rules whose sources disagree, which the pack records rather than tidies away. */
export const RULES_WITH_CONFLICTS: readonly SiteRule[] = COMPLIANCE_PACK.rules
  .filter((rule) => rule.source_conflict_note !== null)
  .map((rule) => RULES.find((row) => row.id === rule.key))
  .filter((rule): rule is SiteRule => rule !== undefined);
