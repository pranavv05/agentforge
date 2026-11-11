import type { ContextEvidence, GroundingFailure } from '@agentforge/contract';

/**
 * The grounding result, above the context document.
 *
 * The document renders evidence as prose, where a verified claim and a failed one read
 * the same — "— verified" and "— unverified (file_not_found)" are both just words in a
 * list. On a tool whose headline measurement is the unverified-claim rate, a reviewer
 * skimming that list can miss the one claim that did not hold up, and then build on it.
 *
 * So the verdict is lifted out of the prose and shown as structure: the rate, the
 * counts, and every failed claim with the verifier's own reason. Failures are listed in
 * full rather than summarised, because the rate is only meaningful if you can see what
 * is behind it.
 */

/** A reviewer-facing explanation per failure kind. */
const REASON: Record<GroundingFailure, string> = {
  file_not_found: 'No such file in the repository.',
  not_a_file: 'The path exists but is not a file.',
  path_escapes_repo: 'The path resolved outside the repository root.',
  line_range_invalid: 'The line range is not a valid range.',
  line_range_past_eof: 'The range extends past the end of the file.',
  symbol_not_in_range: 'The symbol does not appear inside the cited lines.',
  file_unreadable: 'The file could not be read.',
};

export function Grounding({ evidence }: { evidence: readonly ContextEvidence[] }) {
  if (evidence.length === 0) return null;

  const failed = evidence.filter((item) => !item.verified);
  const rate = failed.length / evidence.length;

  return (
    <section className="ground" aria-label="Grounding result">
      <div className="ground__top">
        <span className={`ground__rate${failed.length > 0 ? ' is-bad' : ''}`}>
          {(rate * 100).toFixed(1)}%
        </span>
        <span className="ground__label">
          unverified · {evidence.length - failed.length} of {evidence.length} claims checked out
        </span>
      </div>

      {failed.length > 0 && (
        <ul className="ground__fails">
          {failed.map((item) => (
            <li className="ground__fail" key={item.id}>
              <code className="ground__ref">
                {item.file}:{item.line_start}-{item.line_end}
              </code>
              <span className="ground__why">
                {item.failure_reason === null
                  ? 'Verification failed.'
                  : REASON[item.failure_reason]}
              </span>
              <span className="ground__claim">{item.claim}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
