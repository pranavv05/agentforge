/**
 * Reading a body on the public demo endpoints.
 *
 * These are unauthenticated and take input from anyone, so nothing here trusts the
 * shape of what arrives. They are deliberately *not* wired through the Zod contract
 * used by `/api/specs/**`: that contract describes the product's real surface, and
 * adding demo-only request schemas to it would widen a frozen contract for the sake of
 * a marketing page.
 *
 * Instead the demos coerce. A missing field becomes an empty string or zero and the
 * demo answers with whatever that implies — which is the right behaviour for a toy you
 * are meant to poke at, and is never the behaviour of a route that changes state.
 */

/** Parses a JSON body, treating anything unparseable as an empty object. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Malformed JSON on a demo endpoint is a dead input, not an incident. The caller
    // gets the same answer an empty body would produce.
    return {};
  }
}

/** A string field, or `''`. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A finite number field, or `0`. */
export function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
