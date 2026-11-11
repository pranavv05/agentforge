import { describe, expect, it } from 'vitest';
import {
  AgentForgeError,
  ContractViolationError,
  createClient,
  type SpecState,
} from '../src/index.ts';

/**
 * The typed client.
 *
 * It is the frontend's only route to the backend, so three behaviours matter more than
 * the plumbing: a contract-violating response fails loudly rather than reaching a
 * component, a server error arrives as a typed `ErrorCode` the UI can branch on, and a
 * bad request body is caught before it leaves the browser.
 */

const SPEC = {
  id: 'spec_1',
  title: 'GST invoice export',
  description: 'Export an invoice as GST JSON.',
  mode: 'greenfield' as const,
  repo_path: null,
  status: 'REQ_AWAITING_APPROVAL' as SpecState,
  version: 3,
  created_by: 'reviewer@example.com',
  created_at: '2026-11-09T10:00:00.000Z',
  updated_at: '2026-11-09T10:05:00.000Z',
};

/** A fetch stub that records the request and replies with a fixed payload. */
function stubFetch(
  status: number,
  payload: unknown,
): { fetch: typeof globalThis.fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fetchImpl, calls };
}

describe('listSpecs', () => {
  it('sends the default pagination and parses the response', async () => {
    const { fetch, calls } = stubFetch(200, { specs: [SPEC], total: 1 });
    const client = createClient({ baseUrl: 'http://test', fetch });

    const result = await client.listSpecs();

    expect(result.total).toBe(1);
    expect(result.specs[0]?.title).toBe('GST invoice export');

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/specs');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('0');
    // Null filters are omitted rather than sent as the string "null".
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('passes filters through when supplied', async () => {
    const { fetch, calls } = stubFetch(200, { specs: [], total: 0 });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await client.listSpecs({ status: 'REQ_AWAITING_APPROVAL', mode: 'brownfield', limit: 5 });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('status')).toBe('REQ_AWAITING_APPROVAL');
    expect(url.searchParams.get('mode')).toBe('brownfield');
    expect(url.searchParams.get('limit')).toBe('5');
  });
});

describe('contract enforcement', () => {
  it('throws ContractViolationError when a field is missing', async () => {
    // The backend drops `total`. Without this check the UI would render `undefined`.
    const { fetch } = stubFetch(200, { specs: [SPEC] });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await expect(client.listSpecs()).rejects.toThrow(ContractViolationError);
  });

  it('throws ContractViolationError on an unexpected extra field', async () => {
    const { fetch } = stubFetch(200, { specs: [SPEC], total: 1, surprise: true });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await expect(client.listSpecs()).rejects.toThrow(ContractViolationError);
  });

  it('throws ContractViolationError when a state name is not in the contract', async () => {
    const { fetch } = stubFetch(200, {
      specs: [{ ...SPEC, status: 'SOMETHING_NEW' }],
      total: 1,
    });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await expect(client.listSpecs()).rejects.toThrow(ContractViolationError);
  });
});

describe('error mapping', () => {
  it('rethrows a server error with its taxonomy code', async () => {
    const { fetch } = stubFetch(409, {
      error: {
        code: 'HASH_MISMATCH',
        message: 'the submitted content hash does not match',
        details: { current_version: 2 },
        correlation_id: 'run_abc',
      },
    });
    const client = createClient({ baseUrl: 'http://test', fetch });

    try {
      await client.decideArtifact('spec_1', 'requirements', {
        expected_version: 3,
        content_hash: 'a'.repeat(64),
        decision: 'approve',
        comment: null,
      });
      throw new Error('expected the client to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentForgeError);
      const e = error as AgentForgeError;
      // The UI can branch on this without string-matching the message.
      expect(e.code).toBe('HASH_MISMATCH');
      expect(e.status).toBe(409);
      expect(e.correlationId).toBe('run_abc');
    }
  });

  it('falls back to INTERNAL for a non-conforming error body', async () => {
    const { fetch } = stubFetch(502, '<html>gateway timeout</html>');
    const client = createClient({ baseUrl: 'http://test', fetch });

    try {
      await client.getSpec('spec_1');
      throw new Error('expected the client to throw');
    } catch (error) {
      expect((error as AgentForgeError).code).toBe('INTERNAL');
      expect((error as AgentForgeError).message).toContain('502');
    }
  });
});

describe('request validation', () => {
  it('rejects a greenfield spec carrying a repo path before sending it', async () => {
    const { fetch, calls } = stubFetch(201, { spec: SPEC });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await expect(
      client.createSpec({
        title: 'Contradictory',
        description: 'Greenfield with a repo.',
        mode: 'greenfield',
        repo_path: '/tmp/somewhere',
      }),
    ).rejects.toThrow();

    // Caught at the call site: no request was issued.
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed content hash before sending it', async () => {
    const { fetch, calls } = stubFetch(200, {});
    const client = createClient({ baseUrl: 'http://test', fetch });

    await expect(
      client.decideArtifact('spec_1', 'requirements', {
        expected_version: 1,
        content_hash: 'nope',
        decision: 'approve',
        comment: null,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('headers and paths', () => {
  it('sends the session cookie and never an actor header', async () => {
    // Identity used to travel in an `x-agentforge-actor` header, which meant a caller
    // could name themselves anything in the audit log. The server resolves the actor
    // from the signed session now, so this asserts both halves: the cookie goes, and
    // the spoofable header does not exist.
    const { fetch, calls } = stubFetch(200, { specs: [], total: 0 });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await client.listSpecs();

    expect(calls[0]?.init?.credentials).toBe('same-origin');

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['x-agentforge-actor']).toBeUndefined();
  });

  it('allows credentials to be widened for a cross-origin backend', async () => {
    const { fetch, calls } = stubFetch(200, { specs: [], total: 0 });
    const client = createClient({ baseUrl: 'http://test', fetch, credentials: 'include' });

    await client.listSpecs();

    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('encodes a spec id containing unusual characters', async () => {
    const { fetch, calls } = stubFetch(200, { bundle: null });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await client.getContext('spec/../etc');

    // Path traversal in an id cannot escape the route shape.
    expect(calls[0]?.url).toContain('spec%2F..%2Fetc');
    expect(calls[0]?.url).not.toContain('spec/../etc');
  });

  it('builds the diff path with both versions', async () => {
    const { fetch, calls } = stubFetch(200, {
      kind: 'requirements',
      from_version: 1,
      to_version: 2,
      hunks: [],
    });
    const client = createClient({ baseUrl: 'http://test', fetch });

    await client.diffArtifact('spec_1', 'requirements', 1, 2);

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/specs/spec_1/artifacts/requirements/diff');
    expect(url.searchParams.get('from')).toBe('1');
    expect(url.searchParams.get('to')).toBe('2');
  });

  it('exposes the route manifest so screens need not hard-code paths', () => {
    const client = createClient();
    expect(client.routes.decideArtifact.path).toBe('/api/specs/:id/artifacts/:kind/decide');
  });
});
