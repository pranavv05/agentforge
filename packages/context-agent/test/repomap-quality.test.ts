import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRepoMap, scanRepository } from '../src/index.ts';
import { SAMPLE_REPO, makeFixture, type Fixture } from './fixtures.ts';

/**
 * Repo-map ranking quality.
 *
 * These are regression tests for a failure found by running the scan against a real
 * repository rather than a fixture. The first run ranked local variables named `a`,
 * `map` and `message` above every piece of real API, because:
 *
 * - every local `const` counted as a definition;
 * - symbols resolve by name, so dozens of unrelated locals sharing a name collapsed
 *   into one node with an enormous rank;
 * - `response.status` counted as a reference to a method named `status`.
 *
 * Each test below pins one of the three filters that fixed it. They matter because the
 * repo map is the cheap half of the retrieval strategy: if its top entries are noise,
 * the agent spends its tool-call budget recovering from a bad starting point.
 */

let fx: Fixture;

beforeEach(() => {
  fx = makeFixture(SAMPLE_REPO);
});

afterEach(() => {
  fx.cleanup();
});

describe('only module-level definitions count', () => {
  it('ignores locals and nested functions', async () => {
    fx.write(
      'src/locals.ts',
      [
        'export function outer(): number {',
        '  const localCounter = 1;',
        '  function innerHelper(): number {',
        '    return localCounter;',
        '  }',
        '  return innerHelper();',
        '}',
        'export const moduleLevelThing = 42;',
        '',
      ].join('\n'),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const names = map.definitions.filter((d) => d.file === 'src/locals.ts').map((d) => d.name);

    expect(names).toContain('outer');
    expect(names).toContain('moduleLevelThing');
    expect(names).not.toContain('localCounter');
    expect(names).not.toContain('innerHelper');
  });

  it('keeps class members, which are part of their class API', async () => {
    fx.write(
      'src/service.ts',
      [
        'export class InvoiceService {',
        '  finaliseOne(id: string): string {',
        '    return id;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const names = map.definitions.filter((d) => d.file === 'src/service.ts').map((d) => d.name);

    // A class body does not make a method a local: methods are API.
    expect(names).toContain('InvoiceService');
    expect(names).toContain('finaliseOne');
  });
});

describe('names too short to resolve are ignored', () => {
  it('drops one- and two-character names', async () => {
    fx.write('src/short.ts', ['export const ab = 1;', 'export const abc = 2;', ''].join('\n'));

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const names = map.definitions.filter((d) => d.file === 'src/short.ts').map((d) => d.name);

    // A two-character name matches across the whole repository under name-based
    // resolution, so it carries no signal.
    expect(names).not.toContain('ab');
    expect(names).toContain('abc');
  });
});

describe('test files contribute references but not definitions', () => {
  it('excludes test helpers while still counting their references', async () => {
    fx.write(
      'src/feature.ts',
      ['export function computeTotals(): number {', '  return 1;', '}', ''].join('\n'),
    );
    fx.write(
      'test/feature.test.ts',
      [
        "import { computeTotals } from '../src/feature.ts';",
        'export function testHelperThing(): number {',
        '  return computeTotals();',
        '}',
        '',
      ].join('\n'),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const names = map.definitions.map((d) => d.name);

    // Scaffolding is not what an agent orienting itself needs...
    expect(names).not.toContain('testHelperThing');
    // ...but a symbol exercised by tests is genuinely important, so the reference counts.
    expect(names).toContain('computeTotals');
    expect(map.entries.find((e) => e.name === 'computeTotals')?.referencedByFiles).toBeGreaterThan(
      0,
    );
  });
});

describe('property accesses are not references', () => {
  it('does not credit a same-named method for a property read', async () => {
    fx.write(
      'src/err.ts',
      [
        'export class AppError {',
        '  get statusCode(): number {',
        '    return 500;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    fx.write(
      'src/consumer.ts',
      [
        'export function report(response: { statusCode: number }): number {',
        '  return response.statusCode;',
        '}',
        '',
      ].join('\n'),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const statusCode = map.entries.find((e) => e.name === 'statusCode');

    // A property read cannot be attributed to this getter without real type resolution.
    // Counting it made an error-class getter look like one of the most central symbols
    // in a real codebase.
    expect(statusCode?.referencedByFiles ?? 0).toBe(0);
  });
});

describe('ambiguous names carry no rank', () => {
  it('drops a name defined in too many files to attribute', async () => {
    for (const n of [1, 2, 3, 4]) {
      fx.write(`src/mod${String(n)}.ts`, 'export const sharedName = 1;\n');
    }
    fx.write(
      'src/useShared.ts',
      ["import { sharedName } from './mod1.ts';", 'export const usedHere = sharedName;', ''].join(
        '\n',
      ),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);

    // Four definitions of one name: a reference cannot be attributed to any of them, so
    // the edge is noise. It gets no rank rather than a misleadingly high one.
    expect(map.entries.find((e) => e.name === 'sharedName')?.rank ?? 0).toBe(0);
  });

  it('still ranks a name defined in only two places', async () => {
    // Genuine duplication happens — the same helper in two packages — and must not be
    // thrown away along with the noise.
    fx.write('src/dupA.ts', 'export function resolveThing(): number {\n  return 1;\n}\n');
    fx.write('src/dupB.ts', 'export function resolveThing(): number {\n  return 2;\n}\n');
    fx.write(
      'src/useDup.ts',
      ["import { resolveThing } from './dupA.ts';", 'export const r = resolveThing();', ''].join(
        '\n',
      ),
    );

    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    expect(map.definitions.filter((d) => d.name === 'resolveThing')).toHaveLength(2);
    expect(map.entries.find((e) => e.name === 'resolveThing')?.referencedByFiles).toBeGreaterThan(
      0,
    );
  });
});

describe('the ranking surfaces real API on a realistic repository', () => {
  it('puts a cross-file function above an unreferenced one', async () => {
    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    const names = map.entries.map((e) => e.name);

    const transitionSpec = names.indexOf('transitionSpec');
    const exportGst = names.indexOf('exportGstPayload');

    expect(transitionSpec).toBeGreaterThanOrEqual(0);
    // transitionSpec is called from two files; exportGstPayload from none.
    expect(transitionSpec).toBeLessThan(exportGst === -1 ? Number.MAX_SAFE_INTEGER : exportGst);
  });

  it('contains no single- or double-character entries at all', async () => {
    const map = await buildRepoMap(fx.root, scanRepository(fx.root).files);
    expect(map.entries.filter((e) => e.name.length < 3)).toEqual([]);
  });
});
