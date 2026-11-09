import {
  AgentForgeError,
  ApiErrorSchema,
  ValidationError,
  isAgentForgeError,
} from '@agentforge/contract';
import { newCorrelationId, runLogger } from '@agentforge/orchestrator';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * The route-handler wrapper.
 *
 * Every API route goes through `handle`, which gives the whole surface one behaviour
 * for four things the quality bar requires:
 *
 * - **validation at the boundary** — request bodies and query strings are parsed with
 *   the contract's Zod schemas, so a malformed request never reaches the orchestrator;
 * - **one error mapping** — a thrown `AgentForgeError` becomes its declared HTTP status
 *   and wire shape. Routes never invent their own status codes;
 * - **no swallowed errors** — an unexpected throw is logged with its correlation id and
 *   returned as a 500 carrying that id, never as a misleading success;
 * - **a correlation id per request**, threaded into the orchestrator so the audit log
 *   and the server log can be joined after the fact.
 */

export interface RequestContext {
  readonly correlationId: string;
  readonly log: ReturnType<typeof runLogger>;
}

type Handler<T> = (ctx: RequestContext) => Promise<T> | T;

/** Serialises a successful result at the given status. */
function ok(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handle<T>(handler: Handler<T>, successStatus = 200): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const log = runLogger(correlationId);

  try {
    const body = await handler({ correlationId, log });
    return ok(body, successStatus);
  } catch (error) {
    if (isAgentForgeError(error)) {
      // Expected, classified failures: the taxonomy already knows the status.
      const payload = new AgentForgeError(error.code, error.message, {
        details: error.details,
        correlationId,
      }).toApiError();

      log.warn(
        { code: error.code, status: error.status, details: error.details },
        'request rejected',
      );
      return ok(ApiErrorSchema.parse(payload), error.status);
    }

    // Anything else is a bug. Log it in full, return the correlation id, and say
    // nothing else: internal messages are not a client's business.
    log.error({ err: error }, 'unhandled error in route handler');
    return ok(
      ApiErrorSchema.parse({
        error: {
          code: 'INTERNAL',
          message: 'An unexpected error occurred. Quote the correlation id when reporting it.',
          details: null,
          correlation_id: correlationId,
        },
      }),
      500,
    );
  }
}

/** Parses a JSON request body against a schema, or throws `ValidationError`. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('request body is not valid JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('request body failed validation', {
      issues: z.flattenError(result.error),
    });
  }
  return result.data;
}

/**
 * Parses the query string against a schema.
 *
 * Absent parameters are mapped to `null` before parsing, because the contract models
 * optional filters as nullable rather than optional — it keeps `exactOptionalPropertyTypes`
 * honest and makes "not supplied" explicit on the wire.
 */
export function parseQuery<T>(
  request: Request,
  schema: z.ZodType<T>,
  defaults: Readonly<Record<string, string>> = {},
): T {
  const url = new URL(request.url);
  const raw: Record<string, string | null> = { ...defaults };

  for (const [key, value] of url.searchParams.entries()) {
    raw[key] = value;
  }
  for (const key of Object.keys(schema instanceof z.ZodObject ? schema.shape : {})) {
    raw[key] ??= null;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('query parameters failed validation', {
      issues: z.flattenError(result.error),
    });
  }
  return result.data;
}
