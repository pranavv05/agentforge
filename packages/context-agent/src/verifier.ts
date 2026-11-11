import { type ContextClaim, type GroundingFailure, isAgentForgeError } from '@agentforge/contract';
import { readFileSync, statSync } from 'node:fs';
import { resolveInside, type RepoRoot } from './paths.ts';

/**
 * The grounding verifier.
 *
 * This is the project's research contribution, and it is deliberately the least clever
 * code in the repository. Every claim an agent makes about the codebase is checked by
 * deterministic code against the actual bytes on disk:
 *
 * 1. the path exists inside the repository;
 * 2. it is a file, not a directory;
 * 3. the line range is real and within the file;
 * 4. the named symbol genuinely occurs inside that range.
 *
 * No model participates. That is the whole point: a verifier that asked a model whether
 * a citation was good would inherit exactly the failure mode it exists to measure. The
 * output is the *unverified-claim rate*, which is this project's hallucination metric.
 *
 * Failed claims are reported, never silently dropped — the denominator has to survive,
 * or every run would look perfect.
 */

export interface VerifiedClaim {
  readonly claim: ContextClaim;
  readonly verified: boolean;
  readonly failureReason: GroundingFailure | null;
  /**
   * The exact text of the cited range, for a verified claim.
   *
   * Carried so a reviewer can see what the agent was describing without opening the
   * file, and so the UI can show the evidence rather than assert it.
   */
  readonly excerpt: string | null;
}

export interface VerificationResult {
  readonly claims: readonly VerifiedClaim[];
  readonly total: number;
  readonly verified: number;
  readonly unverified: number;
  /** `unverified / total`, defined as 0 for an empty set. */
  readonly unverifiedClaimRate: number;
  /** Counts per failure kind, so the common failure mode is visible at a glance. */
  readonly failureCounts: Readonly<Partial<Record<GroundingFailure, number>>>;
}

/** Reasonable ceiling on a file we will read to check a citation. */
const MAX_VERIFIABLE_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Splits into lines the way an editor numbers them: 1-based, CRLF and LF alike, and no
 * phantom final line for a trailing newline.
 *
 * Line numbering has to match what `rg` and an editor report, or a correct citation
 * would fail verification over an off-by-one in our own reader.
 */
export function splitLines(contents: string): readonly string[] {
  const normalised = contents.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Verifies one claim. Returns the outcome; never throws for a bad claim. */
export function verifyClaim(root: RepoRoot, claim: ContextClaim): VerifiedClaim {
  const fail = (failureReason: GroundingFailure): VerifiedClaim => ({
    claim,
    verified: false,
    failureReason,
    excerpt: null,
  });

  // 1. Does the path resolve inside the repository?
  let absolute: string;
  try {
    absolute = resolveInside(root, claim.file);
  } catch (error) {
    if (isAgentForgeError(error) && error.code === 'PATH_ESCAPES_ROOT') {
      return fail('path_escapes_repo');
    }
    // Anything else at this stage means the path is not there.
    return fail('file_not_found');
  }

  // 2. Is it a file?
  let size: number;
  try {
    const stat = statSync(absolute);
    if (stat.isDirectory()) return fail('not_a_file');
    if (!stat.isFile()) return fail('not_a_file');
    size = stat.size;
  } catch {
    return fail('file_not_found');
  }

  if (size > MAX_VERIFIABLE_FILE_BYTES) {
    // Refusing to read is honest: we cannot confirm the claim, so it is unverified
    // rather than assumed good.
    return fail('file_unreadable');
  }

  // 3. Is the line range real?
  if (
    !Number.isInteger(claim.line_start) ||
    !Number.isInteger(claim.line_end) ||
    claim.line_start < 1 ||
    claim.line_end < claim.line_start
  ) {
    return fail('line_range_invalid');
  }

  let contents: string;
  try {
    contents = readFileSync(absolute, 'utf8');
  } catch {
    return fail('file_unreadable');
  }

  // A binary file read as UTF-8 yields replacement characters; a citation into one is
  // not something we can honestly confirm.
  if (contents.includes('\u0000')) {
    return fail('file_unreadable');
  }

  const lines = splitLines(contents);
  if (claim.line_end > lines.length) {
    return fail('line_range_past_eof');
  }

  const excerpt = lines.slice(claim.line_start - 1, claim.line_end).join('\n');

  // 4. Does the named symbol actually occur in that range?
  if (claim.symbol !== null && !containsSymbol(excerpt, claim.symbol)) {
    return fail('symbol_not_in_range');
  }

  return { claim, verified: true, failureReason: null, excerpt };
}

/**
 * Whether `symbol` occurs in `text` as a whole identifier.
 *
 * Whole-identifier matching matters in both directions. A substring check would accept
 * a citation to `transition` on a line that only contains `transitionInTx`, which is a
 * different function — the agent would have been wrong and we would have agreed. And
 * rejecting a legitimate match because it is adjacent to a dot or a paren would fail
 * correct citations, which is worse: it would inflate the metric with our own bugs.
 *
 * Symbols are matched literally, not as patterns: a symbol containing regex characters
 * (an operator name, a generic) must not be interpreted.
 */
export function containsSymbol(text: string, symbol: string): boolean {
  const needle = symbol.trim();
  if (needle.length === 0) return false;

  // A dotted or qualified symbol (`Foo.bar`, `std::vector`) is matched as written.
  const isIdentifierChar = (c: string | undefined): boolean =>
    c !== undefined && /[A-Za-z0-9_$]/.test(c);

  const startsWithIdentifierChar = isIdentifierChar(needle[0]);
  const endsWithIdentifierChar = isIdentifierChar(needle[needle.length - 1]);

  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;

    const before = at === 0 ? undefined : text[at - 1];
    const after = at + needle.length >= text.length ? undefined : text[at + needle.length];

    // Only enforce a boundary on an end that is itself an identifier character; a
    // symbol like `#private` or `foo()` carries its own delimiters.
    const okBefore = !startsWithIdentifierChar || !isIdentifierChar(before);
    const okAfter = !endsWithIdentifierChar || !isIdentifierChar(after);

    if (okBefore && okAfter) return true;
    from = at + 1;
  }
}

/**
 * Verifies a batch of claims and computes the rate.
 *
 * Every claim is reported, verified or not. Dropping the failures would make the metric
 * meaningless and the runs flattering.
 */
export function verifyClaims(root: RepoRoot, claims: readonly ContextClaim[]): VerificationResult {
  const verified = claims.map((claim) => verifyClaim(root, claim));

  const failureCounts: Partial<Record<GroundingFailure, number>> = {};
  for (const result of verified) {
    if (result.failureReason !== null) {
      failureCounts[result.failureReason] = (failureCounts[result.failureReason] ?? 0) + 1;
    }
  }

  const verifiedCount = verified.filter((v) => v.verified).length;
  const total = verified.length;

  return {
    claims: verified,
    total,
    verified: verifiedCount,
    unverified: total - verifiedCount,
    // Defined as 0 for an empty set: a run that made no claims must not look like a
    // perfect score on a metric it never attempted.
    unverifiedClaimRate: total === 0 ? 0 : (total - verifiedCount) / total,
    failureCounts,
  };
}

/** A one-line, reviewer-facing explanation of a failure. */
export function explainFailure(reason: GroundingFailure): string {
  switch (reason) {
    case 'file_not_found':
      return 'the cited file does not exist in the repository';
    case 'not_a_file':
      return 'the cited path is a directory, not a file';
    case 'path_escapes_repo':
      return 'the cited path resolves outside the repository';
    case 'line_range_invalid':
      return 'the cited line range is not a valid range';
    case 'line_range_past_eof':
      return 'the cited line range extends past the end of the file';
    case 'symbol_not_in_range':
      return 'the named symbol does not occur within the cited lines';
    case 'file_unreadable':
      return 'the cited file could not be read as text';
  }
}
