import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The marketing site, held to what the product can actually back.
 *
 * The site began as the frontend track's work, built against its *own* backend: its own
 * API, its own database, its own authentication. It advertised per-user encrypted API
 * keys and a one-click demo workspace, documented endpoints this project does not have,
 * and said model output was simulated. None of that was true here, and all of it read as
 * fact. It was caught by reading, once.
 *
 * Work from that track will keep arriving, and the architecture it was ported into does
 * not merge mechanically — so "check it by hand each time" is the control that fails.
 * These tests are the control that does not: they run on every push, and they are cheap.
 *
 * They are blunt on purpose. A false positive costs a minute and a deliberate edit; a
 * false claim in front of an examiner costs the claim.
 */

const WEB = join(import.meta.dirname, '..');

/** Everything a visitor can read: components, generated HTML, docs, and page copy. */
const SCANNED = ['components/site', 'lib/site', 'content/docs', 'app/(marketing)'];

function filesUnder(dir: string): string[] {
  const full = join(WEB, dir);
  if (!existsSync(full)) return [];

  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      // Stylesheets are not copy. The word "simulated" in a class name is not a claim.
      else if (/\.(tsx?|md)$/.test(entry)) found.push(path);
    }
  };
  walk(full);
  return found;
}

/** A phrase this product cannot back, and why — so a failure says what to do about it. */
const UNBACKED: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /bring[- ]your[- ]own[- ]key|\bbyok\b/i,
    why: 'There is no per-user API key feature. One server-side key lives in .env; keys are configuration, not an account setting.',
  },
  {
    pattern: /demo workspace|demo build/i,
    why: 'There is no demo-workspace endpoint, and this is not a demo build: model output is real.',
  },
  {
    pattern: /simulated|simulation/i,
    why: 'Model output is real and every call is recorded to llm_calls. Nothing user-facing is simulated.',
  },
  {
    pattern: /acme-erp/i,
    why: 'That was the frontend track’s invented sample repository. The grounding demo reads this project’s own source.',
  },
  {
    pattern: /PBKDF2/i,
    why: 'Password hashing is Better Auth’s, not a hand-rolled PBKDF2 scheme. Do not state a mechanism this project did not choose.',
  },
  {
    pattern: /\bcloudflare\b|\bhono\b|\bD1\b|wrangler/i,
    why: 'This is a Next.js app on SQLite. The frontend track’s earlier build ran on a different stack.',
  },
  {
    pattern: /api\/auth\/(login|signup|demo)\b|\/api\/me\b|`sid`/,
    why: 'These were the frontend track’s own auth endpoints and cookie. Auth here is Better Auth under /api/auth/*.',
  },
];

describe('the site makes no claim the product cannot back', () => {
  const files = SCANNED.flatMap(filesUnder);

  it('actually scans something', () => {
    // A path typo would make every test below pass over an empty list.
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { pattern, why } of UNBACKED) {
    it(`never says ${String(pattern)}`, () => {
      const hits = files.flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return text
          .split('\n')
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => pattern.test(line))
          .map(({ line, n }) => `${relative(WEB, file)}:${String(n)}  ${line.trim().slice(0, 90)}`);
      });

      expect(hits, `${why}\n`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------

/** Every implemented route, as path segments, with `[x]` marking a dynamic one. */
function implementedRoutes(): readonly (readonly string[])[] {
  const base = join(WEB, 'app', 'api');
  const routes: string[][] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'route.ts') {
        routes.push([
          'api',
          ...relative(base, dir)
            .split(/[\\/]/)
            .filter((s) => s.length > 0),
        ]);
      }
    }
  };
  walk(base);
  return routes;
}

/**
 * Whether a path mentioned in the docs is a route that exists.
 *
 * A documented dynamic segment (`:id`, `$ID`) must land on a dynamic route segment, and
 * a literal one may land on either — `requirements` is a legitimate value of `[kind]`.
 * A catch-all route (`[...all]`) accepts anything beneath its prefix, which is how
 * Better Auth's endpoints are mounted.
 */
function matches(docPath: string, routes: readonly (readonly string[])[]): boolean {
  const doc = docPath
    .replace(/\/+$/, '')
    .split('/')
    .filter((s) => s.length > 0);

  return routes.some((route) => {
    const catchAll = route.findIndex((s) => s.startsWith('[...'));
    if (catchAll >= 0) {
      return doc.length >= catchAll && route.slice(0, catchAll).every((s, i) => s === doc[i]);
    }

    if (route.length !== doc.length) return false;

    return route.every((segment, i) => {
      const d = doc[i] ?? '';
      const dynamicDoc = d.startsWith(':') || d.startsWith('$');
      const dynamicRoute = segment.startsWith('[');
      if (dynamicDoc) return dynamicRoute;
      return dynamicRoute || segment === d;
    });
  });
}

describe('the docs only mention API routes that exist', () => {
  const routes = implementedRoutes();

  /** `/api/...` paths in code spans, tables and curl examples across every doc page. */
  const mentioned = filesUnder('content/docs').flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(
        /(?:https?:\/\/[^\s/`'"]+)?(\/api\/[A-Za-z0-9_:$./-]*)/g,
      ),
    ].map((m) => ({ file: relative(WEB, file), path: (m[1] ?? '').replace(/[.,)]+$/, '') })),
  );

  it('finds the documented routes to check', () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(mentioned.length).toBeGreaterThan(10);
  });

  it('every one is implemented', () => {
    // The ported docs described `/api/me`, `/api/specs/:id/artifact/:type/:version`, and a
    // per-spec cost cap that did not exist. Someone following the quickstart would have hit
    // 404s on the first day.
    const missing = mentioned.filter(({ path }) => !matches(path, routes));

    expect(
      missing.map(({ file, path }) => `${file}: ${path}`),
      'the docs mention a route that is not implemented — fix the docs, or build the route',
    ).toEqual([]);
  });

  it('the matcher itself is not vacuous', () => {
    // A matcher that accepted everything would make the test above meaningless.
    expect(matches('/api/me', routes)).toBe(false);
    expect(matches('/api/specs/:id/artifact/:type/:version', routes)).toBe(false);
    expect(matches('/api/specs/:id/hook', routes)).toBe(false);
    expect(matches('/api/specs/:id/stream', routes)).toBe(true);
    expect(matches('/api/specs/$ID/artifacts/requirements/decide', routes)).toBe(true);
    expect(matches('/api/auth/sign-in/email', routes)).toBe(true);
  });
});
