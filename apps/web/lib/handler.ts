import {
  AgentForgeError,
  ApiErrorSchema,
  ValidationError,
  isAgentForgeError,
} from '@agentforge/contract';
import { newCorrelationId, runLogger, type Actor } from '@agentforge/orchestrator';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestActor } from './actor';

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
 *
 * It is also where **authentication is enforced**, and it is enforced by default. A
 * route gets a signed-in actor or it does not run. Doing this per route would mean every
 * future route has to remember, and the one that forgets is an unauthenticated hole in a
 * system whose entire claim is that gates hold. `handle` therefore fails closed: the
 * only way to serve an unauthenticated request is to say so explicitly, in the call, in
 * a way a reviewer reading the route will see.
 */

/**
 * What a handler is given.
 *
 * Generic over the actor so the type reflects the gate. On a normal route `actor` is an
 * `Actor`, full stop — not `Actor | null` requiring a check the wrapper has already
 * done. Only a route that opted out of authentication sees `null`, and it sees nothing
 * else. That means a route cannot forget to handle the unauthenticated case, because on
 * an authenticated route there is no unauthenticated case to handle.
 */
export interface RequestContext<A extends Actor | null = Actor> {
  readonly correlationId: string;
  readonly log: ReturnType<typeof runLogger>;
  /** The signed-in human, resolved from the session cookie. */
  readonly actor: A;
}

type Handler<T, A extends Actor | null = Actor> = (ctx: RequestContext<A>) => Promise<T> | T;

export interface HandleOptions {
  readonly successStatus?: number;
  /**
   * Serve this route without a signed-in user.
   *
   * Spelled out at the call site on purpose. There is nothing under `/api` that should
   * use it today — a spec list, an artifact and an audit trail are all private project
   * data — so it exists for a future genuinely public endpoint (a health check, say) and
   * to make the default visible by contrast.
   */
  readonly allowAnonymous?: boolean;
}

/** Serialises a successful result at the given status. */
function ok(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Authenticated: the handler is handed a real actor. */
export async function handle<T>(
  request: Request,
  handler: Handler<T>,
  options?: HandleOptions & { allowAnonymous?: false },
): Promise<NextResponse>;

/** Anonymous, by explicit opt-in: there is no actor to hand over. */
export async function handle<T>(
  request: Request,
  handler: Handler<T, null>,
  options: HandleOptions & { allowAnonymous: true },
): Promise<NextResponse>;

export async function handle<T>(
  request: Request,
  handler: Handler<T> | Handler<T, null>,
  options: HandleOptions = {},
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const log = runLogger(correlationId);
  const successStatus = options.successStatus ?? 200;

  try {
    // Before anything else, including body parsing: an unauthenticated caller should
    // learn nothing about whether their payload was well-formed.
    //
    // The cast reconciles the two overloads in one implementation. It is sound because
    // the branch that produces `null` is exactly the branch the anonymous overload
    // selects, and that pairing is the only thing the overloads promise.
    const body =
      options.allowAnonymous === true
        ? await (handler as Handler<T, null>)({ correlationId, log, actor: null })
        : await (handler as Handler<T>)({
            correlationId,
            log,
            actor: await requestActor(request),
          });

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
