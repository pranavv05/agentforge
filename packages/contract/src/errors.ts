import { z } from 'zod';

/**
 * The error taxonomy.
 *
 * Every failure in the system is one of these, each carries an HTTP status, and none
 * is ever swallowed. `catch {}` is banned by lint; code that cannot handle an error
 * rethrows it so the correlation id survives to the logs.
 */

export const ERROR_CODES = [
  /** Input failed schema validation at a trust boundary. */
  'VALIDATION_FAILED',
  /** The requested state move is not in the transition table. */
  'ILLEGAL_TRANSITION',
  /** `expectedVersion` did not match: another writer got there first. */
  'VERSION_CONFLICT',
  /** The submitted content hash does not match the artifact being approved. */
  'HASH_MISMATCH',
  /** A gate precondition failed, e.g. design drafting before requirements approval. */
  'PRECONDITION_FAILED',
  /** A model claim could not be verified against the codebase. */
  'GROUNDING_FAILED',
  /** The run would exceed `SDD_RUN_COST_CAP_USD`. */
  'BUDGET_EXCEEDED',
  /** The agentic loop hit its tool-call or prompt-size ceiling. */
  'BUDGET_LIMIT_REACHED',
  /** A blocking compliance rule is violated. */
  'COMPLIANCE_VIOLATION',
  /** The Claude API or another dependency failed. */
  'UPSTREAM_FAILED',
  /** A path resolved outside the repository root. */
  'PATH_ESCAPES_ROOT',
  /** Entity does not exist. */
  'NOT_FOUND',
  /** Catch-all. Should be rare; every occurrence is worth a look. */
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** HTTP status for each code. Single source, so routes never invent their own mapping. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  ILLEGAL_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  HASH_MISMATCH: 409,
  PRECONDITION_FAILED: 409,
  GROUNDING_FAILED: 422,
  BUDGET_EXCEEDED: 402,
  BUDGET_LIMIT_REACHED: 422,
  COMPLIANCE_VIOLATION: 422,
  UPSTREAM_FAILED: 502,
  PATH_ESCAPES_ROOT: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/** The wire shape of every error response. */
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    /** Machine-readable specifics: the conflicting version, the failing path, etc. */
    details: z.unknown(),
    correlation_id: z.string().min(1).max(64).nullable(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Base class for every error this system raises deliberately.
 *
 * Carrying the code on the error means a route handler can map any thrown
 * `AgentForgeError` to a response without a chain of `instanceof` checks.
 */
export class AgentForgeError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly correlationId: string | null;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; correlationId?: string | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details ?? null;
    this.correlationId = options.correlationId ?? null;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toApiError(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        correlation_id: this.correlationId,
      },
    };
  }
}

/** Input failed schema validation. `details` carries the flattened Zod issues. */
export class ValidationError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details === undefined ? {} : { details });
  }
}

/**
 * A state-machine rule was broken: an illegal move, a stale version, a hash
 * mismatch, or an unmet gate precondition.
 */
export class TransitionError extends AgentForgeError {
  constructor(
    code: Extract<
      ErrorCode,
      'ILLEGAL_TRANSITION' | 'VERSION_CONFLICT' | 'HASH_MISMATCH' | 'PRECONDITION_FAILED'
    >,
    message: string,
    details?: unknown,
  ) {
    super(code, message, details === undefined ? {} : { details });
  }
}

/** A codebase claim did not survive verification. */
export class GroundingError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('GROUNDING_FAILED', message, details === undefined ? {} : { details });
  }
}

/** The run would exceed its dollar ceiling. Raised before the call is made, not after. */
export class BudgetExceededError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('BUDGET_EXCEEDED', message, details === undefined ? {} : { details });
  }
}

/** The Claude API, or another dependency, failed. `cause` keeps the original error. */
export class UpstreamError extends AgentForgeError {
  constructor(message: string, options: { details?: unknown; cause?: unknown } = {}) {
    super('UPSTREAM_FAILED', message, options);
  }
}

/**
 * A blocking compliance rule is violated.
 *
 * Distinct from a grounding failure: the artifact may be perfectly well evidenced and
 * still assert dissolved law, which is the case the versioned pack exists to catch.
 */
export class ComplianceViolationError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('COMPLIANCE_VIOLATION', message, details === undefined ? {} : { details });
  }
}

/** A path resolved outside the repository root, or tried to. */
export class PathEscapesRootError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('PATH_ESCAPES_ROOT', message, details === undefined ? {} : { details });
  }
}

export class NotFoundError extends AgentForgeError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, details === undefined ? {} : { details });
  }
}

/** Narrows an unknown caught value to our error type without an `any` cast. */
export function isAgentForgeError(value: unknown): value is AgentForgeError {
  return value instanceof AgentForgeError;
}
