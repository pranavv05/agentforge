import { describe, expect, it } from 'vitest';
import { diffLines } from '@/lib/diff';

/**
 * Artifact diffing.
 *
 * The diff is what a reviewer reads when deciding whether a redraft addressed their
 * comment, so it has to be minimal and correctly positioned. Line numbers matter: a
 * hunk that claims the wrong range sends a reviewer to the wrong part of the document.
 */

const flat = (text: string): string => text;

describe('diffLines', () => {
  it('reports no hunks for identical input', () => {
    expect(diffLines('a\nb\nc\n', 'a\nb\nc\n')).toEqual([]);
  });

  it('reports no hunks when only the trailing newline differs', () => {
    // A renderer that adds or drops a final newline should not look like a change.
    expect(diffLines('a\nb', 'a\nb\n')).toEqual([]);
  });

  it('treats CRLF and LF as equivalent', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('finds a single changed line', () => {
    const hunks = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk?.lines.map((l) => `${l.op}:${l.text}`)).toEqual([
      'context:a',
      'remove:b',
      'add:B',
      'context:c',
    ]);
    expect(hunk?.from_start).toBe(1);
    expect(hunk?.to_start).toBe(1);
  });

  it('finds a pure addition and positions it correctly', () => {
    const hunks = diffLines('a\nb\n', 'a\nnew\nb\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.filter((l) => l.op === 'add').map((l) => l.text)).toEqual(['new']);
    expect(hunks[0]?.lines.filter((l) => l.op === 'remove')).toEqual([]);
  });

  it('finds a pure deletion', () => {
    const hunks = diffLines('a\ngone\nb\n', 'a\nb\n');
    expect(hunks[0]?.lines.filter((l) => l.op === 'remove').map((l) => l.text)).toEqual(['gone']);
    expect(hunks[0]?.lines.filter((l) => l.op === 'add')).toEqual([]);
  });

  it('handles an empty before and after', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'a\n')[0]?.lines).toEqual([{ op: 'add', text: 'a' }]);
    expect(diffLines('a\n', '')[0]?.lines).toEqual([{ op: 'remove', text: 'a' }]);
  });

  it('merges nearby changes into one hunk', () => {
    // Two edits three lines apart fall inside each other's context window.
    const before = flat('1\n2\n3\n4\n5\n6\n7\n');
    const after = flat('1\nX\n3\n4\n5\nY\n7\n');
    expect(diffLines(before, after)).toHaveLength(1);
  });

  it('keeps distant changes in separate hunks', () => {
    const before = Array.from({ length: 40 }, (_, i) => String(i + 1)).join('\n');
    const after = before.split('\n').map((l, i) => (i === 2 || i === 30 ? `${l}!` : l));
    const hunks = diffLines(before, after.join('\n'));

    expect(hunks).toHaveLength(2);
    // The second hunk starts well into the document, not at line 1.
    expect(hunks[1]?.from_start).toBeGreaterThan(20);
  });

  it('respects the context parameter', () => {
    const before = '1\n2\n3\n4\n5\n6\n7\n8\n9\n';
    const after = '1\n2\n3\n4\nX\n6\n7\n8\n9\n';

    expect(diffLines(before, after, 0)[0]?.lines).toHaveLength(2);
    expect(diffLines(before, after, 1)[0]?.lines).toHaveLength(4);
    expect(diffLines(before, after, 3)[0]?.lines).toHaveLength(8);
  });

  it('counts hunk line totals per side', () => {
    const hunks = diffLines('a\nb\nc\n', 'a\nB1\nB2\nc\n');
    const hunk = hunks[0];
    if (hunk === undefined) throw new Error('expected a hunk');

    // 3 lines on the left (a, b, c), 4 on the right (a, B1, B2, c).
    expect(hunk.from_lines).toBe(3);
    expect(hunk.to_lines).toBe(4);
  });

  it('produces a minimal diff rather than replacing everything', () => {
    // A naive diff would mark all six lines changed; an LCS diff touches only one.
    const before = 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\n';
    const after = 'alpha\nbravo\ncharlie\nDELTA\necho\nfoxtrot\n';
    const changed = diffLines(before, after).flatMap((h) =>
      h.lines.filter((l) => l.op !== 'context'),
    );
    expect(changed).toHaveLength(2);
  });

  it('handles a document reordering without exploding', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'd\nc\nb\na\n';
    const hunks = diffLines(before, after);
    // Whatever the shape, it must round-trip: applying the adds yields the new text.
    const rebuilt = hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.op !== 'remove')
      .map((l) => l.text)
      .join('\n');
    expect(rebuilt).toBe('d\nc\nb\na');
  });
});
