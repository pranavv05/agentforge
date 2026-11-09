/**
 * Line diff for artifact versions.
 *
 * Computed server-side so the reviewer and the audit trail agree on what changed, and
 * so the UI does not need a diff library. A longest-common-subsequence diff over lines
 * gives minimal, stable hunks; context lines are included so a reviewer can see where
 * a change sits without opening both versions side by side.
 */

export type DiffOp = 'context' | 'add' | 'remove';

export interface DiffLine {
  readonly op: DiffOp;
  readonly text: string;
}

export interface DiffHunk {
  readonly from_start: number;
  readonly from_lines: number;
  readonly to_start: number;
  readonly to_lines: number;
  readonly lines: readonly DiffLine[];
}

/** Splits into lines without inventing a trailing empty line for a final newline. */
function toLines(text: string): readonly string[] {
  const normalised = text.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence table over two line arrays.
 *
 * O(n*m) in time and space. Artifact documents are a few hundred lines, so this is
 * well within budget and far easier to verify than a tuned Myers implementation.
 */
function lcsLengths(a: readonly string[], b: readonly string[]): readonly Int32Array[] {
  const table: Int32Array[] = Array.from(
    { length: a.length + 1 },
    () => new Int32Array(b.length + 1),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i];
    const next = table[i + 1];
    if (row === undefined || next === undefined) continue;

    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  return table;
}

/** The full edit script, one entry per line of output. */
function editScript(a: readonly string[], b: readonly string[]): readonly DiffLine[] {
  const table = lcsLengths(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'context', text: a[i] ?? '' });
      i += 1;
      j += 1;
      continue;
    }

    const down = table[i + 1]?.[j] ?? 0;
    const right = table[i]?.[j + 1] ?? 0;

    if (down >= right) {
      out.push({ op: 'remove', text: a[i] ?? '' });
      i += 1;
    } else {
      out.push({ op: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }

  while (i < a.length) {
    out.push({ op: 'remove', text: a[i] ?? '' });
    i += 1;
  }
  while (j < b.length) {
    out.push({ op: 'add', text: b[j] ?? '' });
    j += 1;
  }

  return out;
}

/**
 * Groups an edit script into hunks with up to `context` unchanged lines on each side.
 *
 * Identical inputs produce no hunks at all, which is how the UI tells "nothing changed"
 * apart from "changed everywhere".
 */
export function diffLines(before: string, after: string, context = 3): readonly DiffHunk[] {
  const a = toLines(before);
  const b = toLines(after);
  const script = editScript(a, b);

  // Index each script entry with its 1-based line numbers in both sides.
  interface Positioned extends DiffLine {
    readonly fromLine: number;
    readonly toLine: number;
  }
  const positioned: Positioned[] = [];
  let fromLine = 0;
  let toLine = 0;
  for (const entry of script) {
    if (entry.op !== 'add') fromLine += 1;
    if (entry.op !== 'remove') toLine += 1;
    positioned.push({ ...entry, fromLine, toLine });
  }

  const changedIndexes = positioned
    .map((entry, index) => (entry.op === 'context' ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) return [];

  // Merge nearby changes into one hunk when their context windows touch.
  const ranges: { start: number; end: number }[] = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - context);
    const end = Math.min(positioned.length - 1, index + context);
    const last = ranges[ranges.length - 1];

    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => {
    const lines = positioned.slice(range.start, range.end + 1);
    const first = lines[0];
    const fromCount = lines.filter((l) => l.op !== 'add').length;
    const toCount = lines.filter((l) => l.op !== 'remove').length;

    // A hunk that only adds lines starts at the line *after* the preceding context, so
    // derive the start from the first entry that exists on each side.
    const firstFrom = lines.find((l) => l.op !== 'add');
    const firstTo = lines.find((l) => l.op !== 'remove');

    return {
      from_start: firstFrom?.fromLine ?? first?.fromLine ?? 0,
      from_lines: fromCount,
      to_start: firstTo?.toLine ?? first?.toLine ?? 0,
      to_lines: toCount,
      lines: lines.map(({ op, text }) => ({ op, text })),
    };
  });
}
