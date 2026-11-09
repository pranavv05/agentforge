import { z } from 'zod';

/** A literal backslash, spelled this way so no build step can mangle the escape. */
const BACKSLASH = String.fromCharCode(92);

/**
 * Grounding primitives.
 *
 * A `SourceRef` is the unit of evidence that makes this platform's central claim
 * testable: every statement an agent makes about an existing codebase must point at
 * a concrete `file:line_start-line_end` range, and deterministic code then checks
 * that the path exists inside the repo, the range is real, and the named symbol
 * actually occurs within it. Claims that fail are dropped or flagged *before* they
 * reach requirements.md / design.md.
 */

/** Repo-relative POSIX path. Absolute paths and `..` segments are rejected here, not later. */
export const RepoRelativePathSchema = z
  .string()
  .min(1, 'path must not be empty')
  .max(1024, 'path is implausibly long')
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p), {
    message: 'path must be repo-relative, not absolute',
  })
  .refine((p) => !p.split('/').includes('..'), {
    message: 'path must not contain ".." segments',
  })
  .refine((p) => !p.includes(BACKSLASH), {
    message: 'path must use forward slashes',
  })
  .refine((p) => !p.includes('\0'), { message: 'path must not contain NUL bytes' });

/**
 * A citation into the codebase.
 *
 * Line numbers are 1-based and inclusive, matching how editors and `rg` report them.
 * `symbol` is the identifier the claim is about; when null, the reference is to a
 * region rather than a definition and the verifier checks only path and range.
 */
export const SourceRefSchema = z.strictObject({
  file: RepoRelativePathSchema,
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  symbol: z.string().min(1).max(256).nullable(),
  /** Set when this ref was carried over from a verified `context.json` entry. */
  evidence_id: z.string().min(1).max(64).nullable(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

/** `line_end >= line_start`. Separated so the base shape stays reusable for tool schemas. */
export const ValidSourceRefSchema = SourceRefSchema.refine((r) => r.line_end >= r.line_start, {
  message: 'line_end must be >= line_start',
  path: ['line_end'],
});

/** Why a source ref failed verification. Reported verbatim in the UI and the eval metrics. */
export const GROUNDING_FAILURES = [
  'file_not_found',
  'not_a_file',
  'path_escapes_repo',
  'line_range_invalid',
  'line_range_past_eof',
  'symbol_not_in_range',
  'file_unreadable',
] as const;

export type GroundingFailure = (typeof GROUNDING_FAILURES)[number];

export const GroundingFailureSchema = z.enum(GROUNDING_FAILURES);

/**
 * One piece of evidence the Context Agent produced, after verification.
 *
 * `verified: false` rows are kept rather than discarded — the *unverified-claim rate*
 * is a headline metric, so the denominator has to survive into the database.
 */
export const ContextEvidenceSchema = z.strictObject({
  id: z.string().min(1).max(64),
  file: RepoRelativePathSchema,
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  symbol: z.string().min(1).max(256).nullable(),
  /** The agent's natural-language assertion about this range. */
  claim: z.string().min(1).max(2000),
  /** Why the agent believes this range matters to the requested feature. */
  relevance: z.string().min(1).max(2000),
  verified: z.boolean(),
  failure_reason: GroundingFailureSchema.nullable(),
});

export type ContextEvidence = z.infer<typeof ContextEvidenceSchema>;

/**
 * What the Context Agent emits through strict tool use, before verification.
 *
 * Deliberately flat and free of `id` / `verified` fields: those are assigned by our
 * code, never by the model. Flat schemas also keep strict tool use reliable.
 */
export const ContextClaimSchema = z.strictObject({
  file: RepoRelativePathSchema,
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  symbol: z.string().min(1).max(256).nullable(),
  claim: z.string().min(1).max(2000),
  relevance: z.string().min(1).max(2000),
});

export type ContextClaim = z.infer<typeof ContextClaimSchema>;

/** The Context Agent's full proposal: the payload of its final tool call. */
export const ContextProposalSchema = z.strictObject({
  /** One-paragraph orientation for the downstream Requirement and Design agents. */
  summary: z.string().min(1).max(4000),
  claims: z.array(ContextClaimSchema).min(1).max(200),
  /** Modules the agent believes the feature touches, most relevant first. */
  touched_modules: z.array(z.string().min(1).max(512)).max(100),
  /** Questions the agent could not resolve from the code alone. */
  open_questions: z.array(z.string().min(1).max(1000)).max(20),
});

export type ContextProposal = z.infer<typeof ContextProposalSchema>;

/**
 * The persisted, verified context bundle (`context.json`).
 *
 * This is what crosses a human approval gate. Prompt caches do not survive a
 * reviewer's lunch break, so we persist this compact bundle and rebuild the prompt
 * prefix from it rather than trying to keep a cache warm.
 */
export const ContextBundleSchema = z.strictObject({
  spec_id: z.string().min(1).max(64),
  summary: z.string().min(1).max(4000),
  evidence: z.array(ContextEvidenceSchema),
  touched_modules: z.array(z.string().min(1).max(512)),
  open_questions: z.array(z.string().min(1).max(1000)),
  /** Verification tally. `unverified_claim_rate = unverified / total`, 0 when total is 0. */
  stats: z.strictObject({
    total_claims: z.number().int().nonnegative(),
    verified_claims: z.number().int().nonnegative(),
    unverified_claims: z.number().int().nonnegative(),
    unverified_claim_rate: z.number().min(0).max(1),
    tool_calls_used: z.number().int().nonnegative(),
    retrieval_strategy: z.string().min(1).max(64),
  }),
});

export type ContextBundle = z.infer<typeof ContextBundleSchema>;
