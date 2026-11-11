import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { ContextClaim } from '@agentforge/contract';
import {
  containsSymbol,
  explainFailure,
  splitLines,
  verifyClaim,
  verifyClaims,
} from '../src/index.ts';
import { makeFixture, makeOutsideDir, type Fixture } from './fixtures.ts';

/**
 * The grounding verifier.
 *
 * This is the project's central claim reduced to tests: a citation into the codebase is
 * either confirmed against the real bytes or it is reported as unverified. The suite is
 * deliberately adversarial, because the interesting input is not a correct citation —
 * it is a plausible-looking wrong one, which is exactly what a model produces when it
 * is guessing.
 *
 * Both directions matter. A verifier that accepted a wrong citation would make the
 * metric meaningless; one that rejected a correct citation would inflate the metric
 * with our own bugs and discredit the result.
 */

let fx: Fixture;

const SOURCE = [
  '// Line 1: a comment mentioning transitionSpec by name.',
  'export function finaliseInvoice(id: string): void {', // line 2
  '  transitionSpec(id);', // line 3
  '}', // line 4
  '', // line 5
  'export function transitionSpec(id: string): void {', // line 6
  '  void id;', // line 7
  '}', // line 8
].join('\n');

const claim = (overrides: Partial<ContextClaim> = {}): ContextClaim => ({
  file: 'src/invoice.ts',
  line_start: 2,
  line_end: 4,
  symbol: 'finaliseInvoice',
  claim: 'Finalisation delegates the state change to the orchestrator.',
  relevance: 'The feature extends finalisation.',
  ...overrides,
});

beforeEach(() => {
  fx = makeFixture({ 'src/invoice.ts': `${SOURCE}\n` });
});

afterEach(() => {
  fx.cleanup();
});

describe('a correct citation verifies', () => {
  it('accepts a real path, range and symbol', () => {
    const result = verifyClaim(fx.root, claim());

    expect(result.verified).toBe(true);
    expect(result.failureReason).toBeNull();
    // The excerpt is carried so a reviewer sees the evidence rather than taking our word.
    expect(result.excerpt).toContain('finaliseInvoice');
    expect(result.excerpt?.split('\n')).toHaveLength(3);
  });

  it('accepts a single-line citation', () => {
    const result = verifyClaim(
      fx.root,
      claim({ line_start: 3, line_end: 3, symbol: 'transitionSpec' }),
    );
    expect(result.verified).toBe(true);
    expect(result.excerpt).toBe('  transitionSpec(id);');
  });

  it('accepts a region citation with no symbol', () => {
    // `symbol: null` means "this range", so only path and range are checked.
    const result = verifyClaim(fx.root, claim({ symbol: null, line_start: 1, line_end: 8 }));
    expect(result.verified).toBe(true);
  });

  it('accepts a citation to the exact last line of the file', () => {
    const result = verifyClaim(fx.root, claim({ line_start: 8, line_end: 8, symbol: null }));
    expect(result.verified).toBe(true);
  });
});

describe('fabricated and malformed citations are refused', () => {
  it('rejects a file that does not exist', () => {
    // The headline failure mode: a plausible module the model invented.
    const result = verifyClaim(fx.root, claim({ file: 'src/payouts/tds.ts' }));
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('file_not_found');
    expect(result.excerpt).toBeNull();
  });

  it('rejects a directory cited as a file', () => {
    fx.mkdir('src/billing');
    const result = verifyClaim(fx.root, claim({ file: 'src/billing', symbol: null }));
    expect(result.failureReason).toBe('not_a_file');
  });

  it('rejects a line range that runs past the end of the file', () => {
    const result = verifyClaim(fx.root, claim({ line_start: 6, line_end: 9, symbol: null }));
    expect(result.failureReason).toBe('line_range_past_eof');
  });

  it('rejects an inverted range', () => {
    const result = verifyClaim(fx.root, claim({ line_start: 6, line_end: 2 }));
    expect(result.failureReason).toBe('line_range_invalid');
  });

  it('rejects a zero or negative start line', () => {
    for (const line_start of [0, -1]) {
      const result = verifyClaim(fx.root, claim({ line_start, line_end: 4, symbol: null }));
      expect(result.failureReason, String(line_start)).toBe('line_range_invalid');
    }
  });

  it('rejects a non-integer line number', () => {
    const result = verifyClaim(fx.root, claim({ line_start: 2.5, line_end: 4, symbol: null }));
    expect(result.failureReason).toBe('line_range_invalid');
  });

  it('rejects a symbol that is not in the cited range', () => {
    // The file does define transitionSpec — at line 6, not in 2-4. A path-only check
    // would have accepted this, and the citation would have been wrong.
    const result = verifyClaim(
      fx.root,
      claim({ line_start: 2, line_end: 4, symbol: 'exportGstPayload' }),
    );
    expect(result.failureReason).toBe('symbol_not_in_range');
  });

  it('rejects an off-by-one range that excludes the symbol', () => {
    // transitionSpec is defined on line 6; citing 7-8 misses it by one line.
    const result = verifyClaim(
      fx.root,
      claim({ line_start: 7, line_end: 8, symbol: 'transitionSpec' }),
    );
    expect(result.failureReason).toBe('symbol_not_in_range');
  });

  it('rejects a path that escapes the repository', () => {
    const result = verifyClaim(fx.root, claim({ file: '../../etc/passwd', symbol: null }));
    expect(result.failureReason).toBe('path_escapes_repo');
  });

  it('rejects an absolute path', () => {
    const result = verifyClaim(
      fx.root,
      claim({
        file: process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/passwd',
        symbol: null,
      }),
    );
    expect(result.failureReason).toBe('path_escapes_repo');
  });
});

describe('a symbol in a comment still counts, and that is deliberate', () => {
  it('accepts a symbol that appears only in a comment inside the range', () => {
    // Line 1 mentions transitionSpec in prose. The verifier's job is to confirm the
    // symbol occurs in the cited text, not to judge whether the agent's description is
    // a good one — that is a reviewer's call. Being stricter here would reject correct
    // citations to documentation and inflate the metric with our own strictness.
    const result = verifyClaim(
      fx.root,
      claim({ line_start: 1, line_end: 1, symbol: 'transitionSpec' }),
    );
    expect(result.verified).toBe(true);
  });
});

describe('line endings and encodings', () => {
  it('numbers CRLF files the same as LF files', () => {
    fx.write('src/crlf.ts', SOURCE.split('\n').join('\r\n') + '\r\n');

    const result = verifyClaim(
      fx.root,
      claim({ file: 'src/crlf.ts', line_start: 6, line_end: 6, symbol: 'transitionSpec' }),
    );
    // A citation produced against the file as an editor shows it must verify, whatever
    // the line endings are.
    expect(result.verified).toBe(true);
  });

  it('handles a file with no trailing newline', () => {
    fx.write('src/noeol.ts', 'export const a = 1;\nexport const b = 2;');

    expect(
      verifyClaim(fx.root, claim({ file: 'src/noeol.ts', line_start: 2, line_end: 2, symbol: 'b' }))
        .verified,
    ).toBe(true);
    // And citing a third line must still fail: a trailing newline must not create one.
    expect(
      verifyClaim(
        fx.root,
        claim({ file: 'src/noeol.ts', line_start: 3, line_end: 3, symbol: null }),
      ).failureReason,
    ).toBe('line_range_past_eof');
  });

  it('verifies a citation into a file with non-ASCII content', () => {
    fx.write(
      'src/unicode.ts',
      ['// Facturación: cálculo de impuestos.', 'export const añoFiscal = 2026;', ''].join('\n'),
    );

    const result = verifyClaim(
      fx.root,
      claim({ file: 'src/unicode.ts', line_start: 2, line_end: 2, symbol: 'añoFiscal' }),
    );
    expect(result.verified).toBe(true);
  });

  it('refuses a binary file rather than guessing', () => {
    fx.write('src/blob.bin', 'before\u0000after');

    const result = verifyClaim(
      fx.root,
      claim({ file: 'src/blob.bin', line_start: 1, line_end: 1, symbol: null }),
    );
    // Cannot be honestly confirmed, so it is unverified rather than assumed good.
    expect(result.failureReason).toBe('file_unreadable');
  });
});

describe('symlinks', () => {
  it('refuses a symlink that resolves outside the repository', () => {
    const outside = makeOutsideDir();
    try {
      const created = fx.link('src/escape.txt', join(outside.dir, 'secret.txt'));
      if (!created) {
        // Reported rather than silently passing: on unprivileged Windows this check is
        // not exercised, and a green run should not imply that it was.
        console.warn('symlink creation unavailable on this platform; escape check skipped');
        return;
      }

      const result = verifyClaim(
        fx.root,
        claim({ file: 'src/escape.txt', line_start: 1, line_end: 1, symbol: null }),
      );
      expect(result.verified).toBe(false);
      expect(result.failureReason).toBe('path_escapes_repo');
    } finally {
      outside.cleanup();
    }
  });

  it('accepts a symlink that stays inside the repository', () => {
    const created = fx.link('src/alias.ts', join(fx.dir, 'src', 'invoice.ts'));
    if (!created) {
      console.warn('symlink creation unavailable on this platform; inside-link check skipped');
      return;
    }

    const result = verifyClaim(
      fx.root,
      claim({ file: 'src/alias.ts', line_start: 6, line_end: 6, symbol: 'transitionSpec' }),
    );
    expect(result.verified).toBe(true);
  });
});

describe('containsSymbol', () => {
  it('matches a whole identifier', () => {
    expect(containsSymbol('export function transitionSpec(id) {}', 'transitionSpec')).toBe(true);
  });

  it('does not match a longer identifier that merely contains it', () => {
    // Accepting this would mean agreeing with a citation to a different function.
    expect(containsSymbol('transitionInTx(id)', 'transition')).toBe(false);
    expect(containsSymbol('const finaliseInvoiceLater = 1;', 'finaliseInvoice')).toBe(false);
  });

  it('matches next to punctuation', () => {
    for (const text of ['foo(bar)', 'a.bar;', '[bar]', 'x = bar', '{bar}', 'bar']) {
      expect(containsSymbol(text, 'bar'), text).toBe(true);
    }
  });

  it('does not match inside a word', () => {
    for (const text of ['barn', 'crowbar', 'rebarbative', 'bar_baz', 'bar2']) {
      expect(containsSymbol(text, 'bar'), text).toBe(false);
    }
  });

  it('treats the symbol literally, not as a pattern', () => {
    // A symbol with regex characters must not be interpreted.
    expect(containsSymbol('const a = b;', 'a.*b')).toBe(false);
    expect(containsSymbol('call(a.*b)', 'a.*b')).toBe(true);
    expect(containsSymbol('operator+()', 'operator+')).toBe(true);
  });

  it('matches qualified symbols as written', () => {
    expect(containsSymbol('std::vector<int> v;', 'std::vector')).toBe(true);
    expect(containsSymbol('Foo.bar()', 'Foo.bar')).toBe(true);
  });

  it('rejects an empty or whitespace symbol', () => {
    expect(containsSymbol('anything', '')).toBe(false);
    expect(containsSymbol('anything', '   ')).toBe(false);
  });
});

describe('splitLines', () => {
  it('numbers lines the way an editor does', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    // A blank line in the middle is a line; a trailing newline is not.
    expect(splitLines('a\n\nc\n')).toEqual(['a', '', 'c']);
  });
});

describe('the unverified-claim rate', () => {
  it('computes the rate and counts failures by kind', () => {
    const result = verifyClaims(fx.root, [
      claim(),
      claim({ line_start: 6, line_end: 6, symbol: 'transitionSpec' }),
      claim({ file: 'src/invented.ts' }),
      claim({ file: 'src/also-invented.ts' }),
      claim({ line_start: 2, line_end: 4, symbol: 'notPresent' }),
    ]);

    expect(result.total).toBe(5);
    expect(result.verified).toBe(2);
    expect(result.unverified).toBe(3);
    expect(result.unverifiedClaimRate).toBeCloseTo(0.6, 10);
    expect(result.failureCounts).toEqual({ file_not_found: 2, symbol_not_in_range: 1 });
  });

  it('keeps failed claims rather than dropping them', () => {
    const result = verifyClaims(fx.root, [claim({ file: 'src/invented.ts' })]);

    // The denominator has to survive, or every run would look perfect.
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.verified).toBe(false);
    expect(result.claims[0]?.claim.file).toBe('src/invented.ts');
  });

  it('reports a rate of 0 for an empty set, not a perfect score', () => {
    const result = verifyClaims(fx.root, []);
    expect(result.total).toBe(0);
    // A run that made no claims must not look like it scored perfectly on a metric it
    // never attempted.
    expect(result.unverifiedClaimRate).toBe(0);
    expect(result.failureCounts).toEqual({});
  });

  it('reports a rate of 1 when everything was fabricated', () => {
    const result = verifyClaims(fx.root, [claim({ file: 'a.ts' }), claim({ file: 'b.ts' })]);
    expect(result.unverifiedClaimRate).toBe(1);
  });
});

describe('explainFailure', () => {
  it('gives a reviewer-facing sentence for every failure kind', () => {
    const kinds = [
      'file_not_found',
      'not_a_file',
      'path_escapes_repo',
      'line_range_invalid',
      'line_range_past_eof',
      'symbol_not_in_range',
      'file_unreadable',
    ] as const;

    for (const kind of kinds) {
      const text = explainFailure(kind);
      expect(text.length, kind).toBeGreaterThan(20);
      expect(text, kind).not.toContain('_');
    }
  });
});
