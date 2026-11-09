import { z } from 'zod';
import {
  AnswerClarificationsRequestSchema,
  CreateSpecRequestSchema,
  CreateSpecResponseSchema,
  DecideArtifactRequestSchema,
  DecideArtifactResponseSchema,
  DiffArtifactResponseSchema,
  GetArtifactResponseSchema,
  GetAuditResponseSchema,
  GetCompliancePackResponseSchema,
  GetComplianceTraceResponseSchema,
  GetContextResponseSchema,
  GetCostResponseSchema,
  GetSpecResponseSchema,
  ListClarificationsResponseSchema,
  ListSpecsResponseSchema,
  ListTasksResponseSchema,
  ROUTES,
} from './api.ts';
import { AgentForgeError, ApiErrorSchema } from './errors.ts';
import type { ArtifactKind, SpecMode, SpecState } from './states.ts';

/**
 * The typed API client.
 *
 * This is the frontend's only route to the backend. It exists so the UI track can be
 * built against the contract alone:
 *
 * - every response is parsed with its contract schema, so a field the backend stops
 *   sending is a loud failure here rather than an `undefined` rendered into the page;
 * - every error response becomes a thrown `AgentForgeError` carrying the real
 *   `ErrorCode`, so a screen can branch on `HASH_MISMATCH` without string-matching
 *   messages or reading status numbers;
 * - request bodies are validated before they leave the browser, which catches a
 *   mistyped field at the call site instead of as a 400 three screens later.
 *
 * Deliberately dependency-free and `node:`-free: this module runs in the browser, so it
 * uses `fetch` and nothing else.
 */

export interface ClientOptions {
  /** Base URL. Defaults to same-origin, which is what the Next app wants. */
  readonly baseUrl?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Reviewer identity, sent as `x-agentforge-actor`.
   *
   * The server always treats an HTTP caller as a `human` regardless of this value, so
   * it names the reviewer for the audit log; it is not a privilege claim.
   */
  readonly actor?: string;
}

/** Thrown when a response cannot be parsed against its contract schema. */
export class ContractViolationError extends Error {
  readonly issues: unknown;

  constructor(route: string, issues: unknown) {
    super(`the response from ${route} did not match its contract schema`);
    this.name = 'ContractViolationError';
    this.issues = issues;
  }
}

type Query = Readonly<Record<string, string | number | null | undefined>>;

function withQuery(path: string, query?: Query): string {
  if (query === undefined) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length === 0 ? path : `${path}?${qs}`;
}

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    route: string,
    init: { method: 'GET' | 'POST'; path: string; body?: unknown },
    responseSchema: z.ZodType<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (options.actor !== undefined) headers['x-agentforge-actor'] = options.actor;

    const response = await doFetch(`${baseUrl}${init.path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const asError = ApiErrorSchema.safeParse(payload);
      if (asError.success) {
        // Rethrown with the server's own code, so callers branch on the taxonomy.
        throw new AgentForgeError(asError.data.error.code, asError.data.error.message, {
          details: asError.data.error.details,
          correlationId: asError.data.error.correlation_id,
        });
      }
      throw new AgentForgeError(
        'INTERNAL',
        `${route} failed with status ${String(response.status)}`,
        { details: payload },
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractViolationError(route, z.flattenError(parsed.error));
    }
    return parsed.data;
  }

  const specPath = (id: string): string => `/api/specs/${encodeURIComponent(id)}`;
  const artifactPath = (id: string, kind: ArtifactKind): string =>
    `${specPath(id)}/artifacts/${kind}`;

  return {
    /** The declared route table, so a screen can link without hard-coding paths. */
    routes: ROUTES,

    listSpecs: async (
      query: {
        status?: SpecState | null;
        mode?: SpecMode | null;
        limit?: number;
        offset?: number;
      } = {},
    ) =>
      await request(
        'listSpecs',
        {
          method: 'GET',
          path: withQuery('/api/specs', {
            status: query.status ?? null,
            mode: query.mode ?? null,
            limit: query.limit ?? 25,
            offset: query.offset ?? 0,
          }),
        },
        ListSpecsResponseSchema,
      ),

    createSpec: async (body: z.input<typeof CreateSpecRequestSchema>) =>
      await request(
        'createSpec',
        { method: 'POST', path: '/api/specs', body: CreateSpecRequestSchema.parse(body) },
        CreateSpecResponseSchema,
      ),

    getSpec: async (id: string) =>
      await request('getSpec', { method: 'GET', path: specPath(id) }, GetSpecResponseSchema),

    getArtifact: async (id: string, kind: ArtifactKind, version?: number) =>
      await request(
        'getArtifact',
        { method: 'GET', path: withQuery(artifactPath(id, kind), { version }) },
        GetArtifactResponseSchema,
      ),

    diffArtifact: async (id: string, kind: ArtifactKind, from: number, to: number) =>
      await request(
        'diffArtifact',
        { method: 'GET', path: withQuery(`${artifactPath(id, kind)}/diff`, { from, to }) },
        DiffArtifactResponseSchema,
      ),

    /**
     * Records an approval decision.
     *
     * `content_hash` must be the hash of the version the reviewer actually read — take
     * it from `getArtifact`. A stale hash throws `AgentForgeError` with code
     * `HASH_MISMATCH`, which the UI should surface as "this changed, re-read it" rather
     * than as a generic failure.
     */
    decideArtifact: async (
      id: string,
      kind: ArtifactKind,
      body: z.input<typeof DecideArtifactRequestSchema>,
    ) =>
      await request(
        'decideArtifact',
        {
          method: 'POST',
          path: `${artifactPath(id, kind)}/decide`,
          body: DecideArtifactRequestSchema.parse(body),
        },
        DecideArtifactResponseSchema,
      ),

    listClarifications: async (id: string) =>
      await request(
        'listClarifications',
        { method: 'GET', path: `${specPath(id)}/clarifications` },
        ListClarificationsResponseSchema,
      ),

    answerClarifications: async (
      id: string,
      body: z.input<typeof AnswerClarificationsRequestSchema>,
    ) =>
      await request(
        'answerClarifications',
        {
          method: 'POST',
          path: `${specPath(id)}/clarifications/answer`,
          body: AnswerClarificationsRequestSchema.parse(body),
        },
        ListClarificationsResponseSchema,
      ),

    getContext: async (id: string) =>
      await request(
        'getContext',
        { method: 'GET', path: `${specPath(id)}/context` },
        GetContextResponseSchema,
      ),

    getAudit: async (id: string) =>
      await request(
        'getAudit',
        { method: 'GET', path: `${specPath(id)}/audit` },
        GetAuditResponseSchema,
      ),

    getCost: async (id: string) =>
      await request(
        'getCost',
        { method: 'GET', path: `${specPath(id)}/cost` },
        GetCostResponseSchema,
      ),

    listTasks: async (id: string) =>
      await request(
        'listTasks',
        { method: 'GET', path: `${specPath(id)}/tasks` },
        ListTasksResponseSchema,
      ),

    getCompliancePack: async () =>
      await request(
        'getCompliancePack',
        { method: 'GET', path: '/api/compliance/pack' },
        GetCompliancePackResponseSchema,
      ),

    getComplianceTrace: async (id: string) =>
      await request(
        'getComplianceTrace',
        { method: 'GET', path: `${specPath(id)}/compliance/trace` },
        GetComplianceTraceResponseSchema,
      ),
  };
}

export type AgentForgeClient = ReturnType<typeof createClient>;
