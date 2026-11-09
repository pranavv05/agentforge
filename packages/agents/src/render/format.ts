import type { SourceRef } from '@agentforge/contract';

/**
 * Markdown formatting primitives.
 *
 * Every document in this system is rendered from validated JSON by pure functions.
 * Nothing here consults the clock, the filesystem or a random source, because the
 * renderers are covered by golden-file tests and, more importantly, because a document
 * that varies between renders would change its own content hash and silently invalidate
 * an approval.
 */

/** Escapes the characters that would break a markdown table cell. */
export function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Renders a source ref as a clickable-looking `path:start-end` reference. */
export function sourceRef(ref: SourceRef): string {
  const range =
    ref.line_start === ref.line_end
      ? String(ref.line_start)
      : `${String(ref.line_start)}-${String(ref.line_end)}`;
  const symbol = ref.symbol === null ? '' : ` (\`${ref.symbol}\`)`;
  const evidence = ref.evidence_id === null ? '' : ` [${ref.evidence_id}]`;
  return `\`${ref.file}:${range}\`${symbol}${evidence}`;
}

/** A bullet list, or a single em-dash bullet when empty, so sections never look broken. */
export function bullets(items: readonly string[]): string {
  if (items.length === 0) return '- —\n';
  return items.map((item) => `- ${item}\n`).join('');
}

/** A comma-separated inline list, or an em dash when empty. */
export function inlineList(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(', ');
}

/** Joins pre-rendered blocks with exactly one blank line between them. */
export function joinBlocks(blocks: readonly string[]): string {
  return blocks
    .map((b) => b.trimEnd())
    .filter((b) => b.length > 0)
    .join('\n\n');
}

/** A markdown table. Returns an empty string when there are no rows. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '';
  const head = `| ${headers.join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n');
  return `${head}\n${rule}\n${body}`;
}

/** Normalises a rendered document: trailing newline, no trailing whitespace. */
export function finalise(markdown: string): string {
  return `${markdown.replace(/[ \t]+$/gm, '').trimEnd()}\n`;
}

/** Human-readable label for an EARS pattern. */
export const EARS_LABELS = {
  ubiquitous: 'Ubiquitous',
  event_driven: 'Event-driven',
  state_driven: 'State-driven',
  unwanted_behaviour: 'Unwanted behaviour',
  optional_feature: 'Optional feature',
} as const;
