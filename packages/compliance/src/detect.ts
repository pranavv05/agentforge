import {
  type ComplianceRule,
  type ComplianceViolation,
  ValidationError,
} from '@agentforge/contract';
import { COMPLIANCE_PACK } from './pack.ts';

/**
 * Superseded-terminology detection.
 *
 * This is the compliance pack earning its keep. A design that says "deduct TDS under
 * Section 194J" reads perfectly well and would pass any human skim, but the 194-series
 * was dissolved by the Income-tax Act 2025 on 1 April 2026 — so the statement is wrong
 * law, and the kind of wrong that a static checklist would never catch because the
 * checklist itself would still say 194J.
 *
 * Detection is deterministic text matching over the artifact's own fields. It is not a
 * model judgement, so it cannot be talked out of a verdict, and it reports *where* the
 * match was so a reviewer can see it rather than take our word.
 */

/** A compiled detector, cached so the patterns are not recompiled per call. */
interface Detector {
  readonly ruleKey: string;
  readonly severity: ComplianceRule['severity'];
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly explanation: string;
}

/**
 * Compiles every superseded-term pattern in a pack.
 *
 * A malformed pattern is a hard error: a detector that silently matches nothing is
 * worse than no detector, because it reports compliance that was never checked.
 */
export function compileDetectors(
  rules: readonly ComplianceRule[] = COMPLIANCE_PACK.rules,
): readonly Detector[] {
  return rules.flatMap((rule) =>
    rule.superseded_terms.map((term) => {
      let pattern: RegExp;
      try {
        // Case-insensitive: "section 194j" and "Section 194J" are the same error.
        pattern = new RegExp(term.pattern, 'gi');
      } catch (cause) {
        throw new ValidationError(
          `compliance rule ${rule.key} has an invalid superseded-term pattern`,
          {
            rule_key: rule.key,
            pattern: term.pattern,
            cause: cause instanceof Error ? cause.message : String(cause),
          },
        );
      }

      return {
        ruleKey: rule.key,
        severity: rule.severity,
        pattern,
        replacement: term.replacement,
        explanation: term.explanation,
      };
    }),
  );
}

let cached: readonly Detector[] | null = null;

function detectors(): readonly Detector[] {
  cached ??= compileDetectors();
  return cached;
}

/**
 * Whether a mention of a dissolved section is *about* its being dissolved.
 *
 * The guard used to block any text containing "Section 194J". That produced a
 * contradiction a stub could never show and a live model hit on its first real run: the
 * pack's own acceptance criterion says a deduction configured against Section 194J must be
 * rejected and the Section 393 equivalent named — so every correct design has to *write
 * the words* "Section 194J" — and the lint then refused every correct design. Two live runs,
 * on two different models, were refused for exactly that.
 *
 * Citing a dissolved section as current law and naming it as the thing being rejected are
 * different acts, and only the first is wrong law. The distinction is drawn per sentence:
 * a mention is accepted when *its own sentence* either names the replacement (Section 393)
 * or says the section is rejected, legacy or superseded.
 *
 * Deliberately per sentence, not per paragraph. A neighbouring sentence that happens to
 * mention Section 393 must not excuse a bare "deduct under Section 194J" next to it, and a
 * wider window would let it.
 *
 * It is a heuristic, and the limits are known rather than hidden. A sentence written to
 * pass it — "Section 194J applies (see Section 393)" — will pass. That is accepted because
 * the human approval gate is still the control, and because the alternative was blocking
 * correct work. A match that qualifies is therefore not dropped: it is reported as
 * `advisory`, so the reviewer still sees it in the trace, just without it stopping the
 * design.
 */
const NAMES_REPLACEMENT = /\b393\b/;
const SAYS_LEGACY =
  /\b(reject\w*|legacy|no longer|superseded|dissolved|replaced?|replaces|replacement|formerly|repealed|obsolete|deprecated|equivalent|stale|migrat\w*|1961)\b/i;

/** The sentence (or line) containing a match: bounded by a newline, or ". ", "! ", "? ". */
function sentenceAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0) {
    const previous = text[from - 1] ?? '';
    if (previous === '\n') break;
    // A space straight after sentence-ending punctuation is the start of a new sentence.
    if ((previous === ' ' || previous === '\t') && /[.!?]/.test(text[from - 2] ?? '')) break;
    from -= 1;
  }

  let to = end;
  while (to < text.length) {
    const current = text[to] ?? '';
    if (current === '\n') break;
    if (/[.!?]/.test(current) && (to + 1 >= text.length || /\s/.test(text[to + 1] ?? ''))) {
      to += 1;
      break;
    }
    to += 1;
  }

  return text.slice(from, to);
}

/** Whether the mention at [start, end) is named as legacy or rejected, not cited as law. */
export function isMappingMention(text: string, start: number, end: number): boolean {
  const sentence = sentenceAround(text, start, end);
  return NAMES_REPLACEMENT.test(sentence) || SAYS_LEGACY.test(sentence);
}

/** One named piece of text to scan, with the location to report it under. */
export interface ScanTarget {
  /** Where this text sits in the artifact, e.g. `design.sections[2].body`. */
  readonly location: string;
  readonly text: string;
}

/**
 * Scans text for superseded terminology.
 *
 * Several patterns may match the same text — the pack has a specific rule for 194J and
 * a catch-all for the rest of the series. Only the first match at a given position is
 * reported, so a reviewer gets the specific guidance rather than two overlapping
 * findings for one phrase.
 */
export function detectSupersededTerms(
  targets: readonly ScanTarget[],
): readonly ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const target of targets) {
    // Tracks the character ranges already reported for this target, so the catch-all
    // pattern does not duplicate a finding the specific pattern already made.
    const claimed: { start: number; end: number }[] = [];

    for (const detector of detectors()) {
      // `lastIndex` persists on a global regex between calls, so reset per use.
      detector.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = detector.pattern.exec(target.text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        // Zero-length matches would loop forever; a pattern that can match empty is a
        // pack bug, but it must not hang the verifier.
        if (match[0].length === 0) {
          detector.pattern.lastIndex += 1;
          continue;
        }

        const overlaps = claimed.some((r) => start < r.end && end > r.start);
        if (!overlaps) {
          claimed.push({ start, end });

          const mapping = isMappingMention(target.text, start, end);

          violations.push({
            rule_key: detector.ruleKey,
            // Downgraded, not dropped: it still appears in the trace for the reviewer.
            severity: mapping ? 'advisory' : detector.severity,
            location: target.location,
            matched_text: match[0],
            replacement: detector.replacement,
            explanation: mapping
              ? 'Named as legacy or rejected, not cited as current law, so it does not block. ' +
                detector.explanation
              : detector.explanation,
          });
        }
      }
    }
  }

  return violations;
}

/** Only the violations that must block approval. */
export function blockingViolations(
  violations: readonly ComplianceViolation[],
): readonly ComplianceViolation[] {
  return violations.filter((v) => v.severity === 'blocking');
}

/** A reviewer-facing summary line per violation. */
export function describeViolation(violation: ComplianceViolation): string {
  return (
    `${violation.location}: "${violation.matched_text}" is superseded — use ` +
    `${violation.replacement}. ${violation.explanation}`
  );
}
