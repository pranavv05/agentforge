import type { ContextEvidence, GroundingFailure, SourceRef } from '@agentforge/contract';

/**
 * Citation checking against verified evidence.
 *
 * This is the first half of the grounding guarantee, and it runs on every brownfield
 * artifact: a citation an agent produced must correspond to a piece of evidence that
 * was already verified against the repository, and must match it exactly.
 *
 * It is deliberately a *deterministic* check over data we already hold, so it costs
 * nothing and cannot be argued out of a verdict. The second half — verifying a range
 * against the filesystem — belongs to the Context Agent's verifier, which is what
 * produced the verified evidence in the first place.
 */

export interface CitationViolation {
  /** Where in the artifact the bad citation sits, e.g. `requirements[0].source_refs[1]`. */
  readonly location: string;
  readonly ref: SourceRef;
  readonly reason: GroundingFailure | 'evidence_not_found' | 'evidence_mismatch';
  readonly detail: string;
}

/** Indexes verified evidence by its `EV-nnn` id. */
function verifiedIndex(evidence: readonly ContextEvidence[]): ReadonlyMap<string, ContextEvidence> {
  return new Map(evidence.filter((e) => e.verified).map((e) => [e.id, e] as const));
}

/**
 * Checks one citation.
 *
 * A citation must name a verified evidence id, and its file, line range and symbol must
 * match that evidence. Allowing a narrower range inside the evidence range would be
 * tempting, but it is not safe: the symbol was verified to occur somewhere in the
 * evidence range, not in an arbitrary sub-range of it.
 */
function checkRef(
  ref: SourceRef,
  location: string,
  index: ReadonlyMap<string, ContextEvidence>,
): CitationViolation | undefined {
  if (ref.evidence_id === null) {
    return {
      location,
      ref,
      reason: 'evidence_not_found',
      detail:
        'the citation names no evidence id; agents may only cite verified evidence, ' +
        'copying its id exactly',
    };
  }

  const evidence = index.get(ref.evidence_id);
  if (evidence === undefined) {
    return {
      location,
      ref,
      reason: 'evidence_not_found',
      detail: `no verified evidence with id ${ref.evidence_id} exists for this spec`,
    };
  }

  if (evidence.file !== ref.file) {
    return {
      location,
      ref,
      reason: 'evidence_mismatch',
      detail: `${ref.evidence_id} is for \`${evidence.file}\`, not \`${ref.file}\``,
    };
  }

  if (evidence.line_start !== ref.line_start || evidence.line_end !== ref.line_end) {
    return {
      location,
      ref,
      reason: 'evidence_mismatch',
      detail:
        `${ref.evidence_id} covers lines ${String(evidence.line_start)}-${String(evidence.line_end)}, ` +
        `but the citation claims ${String(ref.line_start)}-${String(ref.line_end)}`,
    };
  }

  if (evidence.symbol !== ref.symbol) {
    return {
      location,
      ref,
      reason: 'evidence_mismatch',
      detail:
        `${ref.evidence_id} names symbol ${evidence.symbol === null ? '(none)' : `\`${evidence.symbol}\``}, ` +
        `but the citation claims ${ref.symbol === null ? '(none)' : `\`${ref.symbol}\``}`,
    };
  }

  return undefined;
}

/** Checks a list of citations from one location. */
export function checkCitations(
  evidence: readonly ContextEvidence[],
  refs: readonly SourceRef[],
  locationPrefix: string,
): readonly CitationViolation[] {
  const index = verifiedIndex(evidence);

  return refs
    .map((ref, i) => checkRef(ref, `${locationPrefix}[${String(i)}]`, index))
    .filter((v): v is CitationViolation => v !== undefined);
}

/**
 * Every citation in a requirements proposal.
 *
 * Takes the arrays rather than the whole proposal so the same checker serves
 * requirements, design and tasks without three near-identical functions.
 */
export function checkAllCitations(
  evidence: readonly ContextEvidence[],
  groups: readonly { readonly location: string; readonly refs: readonly SourceRef[] }[],
): readonly CitationViolation[] {
  return groups.flatMap((group) => checkCitations(evidence, group.refs, group.location));
}

/** Human-readable summary for an error message or a reviewer-facing warning. */
export function describeViolations(violations: readonly CitationViolation[]): string {
  return violations.map((v) => `${v.location}: ${v.detail}`).join('; ');
}
