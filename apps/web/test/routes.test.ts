import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, type RouteName } from '@agentforge/contract';

/**
 * Route-manifest conformance.
 *
 * The contract's `ROUTES` manifest is the declared HTTP surface the frontend builds
 * against. This test keeps the manifest and the filesystem honest in both directions:
 *
 * - **no undocumented routes** — a route file with no manifest entry fails, so the API
 *   cannot grow a surface the contract does not describe;
 * - **no silent gaps** — manifest entries that are not yet implemented must appear in
 *   `PENDING` below. When a later day implements one, this test fails until the entry
 *   is removed, so the list shrinks deliberately rather than being forgotten.
 */

const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url));

/**
 * Manifest routes that have no handler yet.
 *
 * Each is listed with the reason, and each must be deleted from this list as it lands.
 * An empty list is the goal state.
 */
const PENDING: Readonly<Partial<Record<RouteName, string>>> = {};

/**
 * Route prefixes that are deliberately outside the frozen contract.
 *
 * `packages/contract` describes the spec API — the surface the frontend and the
 * examiners reason about. Better Auth's endpoints live under /api/auth and their paths,
 * request shapes and responses are the library's contract, not ours. Mirroring them into
 * ROUTES would make a frozen contract claim to describe something this project does not
 * control, and it would go stale the first time the dependency is upgraded.
 *
 * `/api/public` is the marketing site's demo surface: the transition explorer, the
 * edit-hook tester, the compliance lint, the TDS calculator and the grounding
 * playground. They are unauthenticated, read-only, and pure functions of data this
 * repository already ships — no spec is touched and no model is called.
 *
 * They are excluded for the opposite reason to Better Auth's: not because someone else
 * owns them, but because the contract describes the product's API and these exist to
 * show a marketing page working. Declaring them would widen a frozen contract for the
 * sake of a demo, and every client generated from it would gain endpoints no client
 * should call.
 *
 * The exemption is a prefix list rather than a blanket skip, so a stray handler written
 * anywhere else is still caught.
 */
const OUTSIDE_CONTRACT: readonly string[] = ['/api/auth/', '/api/public/'];

function isOutsideContract(path: string): boolean {
  return OUTSIDE_CONTRACT.some((prefix) => path.startsWith(prefix));
}

/** Walks the api directory and returns the route path of every `route.ts`. */
function implementedRoutes(): readonly string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== 'route.ts') continue;

      // apps/web/app/api/specs/[id]/audit/route.ts -> /api/specs/:id/audit
      const segments = relative(API_DIR, dir)
        .split(sep)
        .filter((s) => s.length > 0);
      const path = segments
        .map((s) => (s.startsWith('[') && s.endsWith(']') ? `:${s.slice(1, -1)}` : s))
        .join('/');
      found.push(path.length === 0 ? '/api' : `/api/${path}`);
    }
  };

  walk(API_DIR);
  return found.sort();
}

// Widened to Set<string> deliberately: ROUTES is `as const`, so the inferred element
// type is a union of literal paths, and the filesystem paths being compared are plain
// strings.
const manifestPaths = new Set<string>(Object.values(ROUTES).map((r) => r.path));

describe('route manifest', () => {
  it('declares a plausible number of routes', () => {
    expect(Object.keys(ROUTES).length).toBeGreaterThanOrEqual(15);
  });

  it('has no duplicate method+path pairs', () => {
    const keys = Object.values(ROUTES).map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('implements no route the contract does not declare', () => {
    const undocumented = implementedRoutes()
      .filter((path) => !manifestPaths.has(path))
      .filter((path) => !isOutsideContract(path));
    expect(undocumented, 'route handlers with no entry in the ROUTES manifest').toEqual([]);
  });

  it('exempts only the library-owned prefixes that actually exist', () => {
    // Keeps the exemption list honest: if the auth routes are ever removed or moved, the
    // stale prefix fails here instead of quietly widening what the manifest test ignores.
    const implemented = implementedRoutes();
    const unused = OUTSIDE_CONTRACT.filter(
      (prefix) => !implemented.some((path) => path.startsWith(prefix)),
    );
    expect(unused, 'library-owned prefixes matching no handler').toEqual([]);
  });

  it('implements every manifest route that is not explicitly pending', () => {
    const implemented = new Set(implementedRoutes());
    const missing = Object.entries(ROUTES)
      .filter(([name]) => !(name in PENDING))
      .filter(([, route]) => !implemented.has(route.path))
      .map(([name, route]) => `${name} (${route.method} ${route.path})`);

    expect(missing, 'declared, not pending, but not implemented').toEqual([]);
  });

  it('lists no pending route that is already implemented', () => {
    // Forces the PENDING list to shrink as capabilities land, instead of going stale.
    const implemented = new Set(implementedRoutes());
    const stale = Object.keys(PENDING)
      .filter((name): name is RouteName => name in ROUTES)
      .filter((name) => implemented.has(ROUTES[name].path));

    expect(stale, 'routes marked pending that now exist — remove them from PENDING').toEqual([]);
  });

  it('names a reason for every pending route', () => {
    for (const [name, reason] of Object.entries(PENDING)) {
      expect(reason, `${name} must say why it is pending`).toMatch(/\S/);
    }
  });
});
