import type { ReactNode } from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';

/**
 * A renderer for *our own* generated markdown.
 *
 * Not a general markdown implementation, and deliberately not one. Every document shown
 * through this component is produced by the deterministic renderers in
 * `packages/agents/src/render`, which emit a closed set of constructs: headings to level
 * four, paragraphs, unordered lists, pipe tables, `**bold**` and `` `code` ``. Supporting
 * exactly that set is a few dozen lines and can be read in full; pulling in a parser
 * would add a dependency tree to render text we generate ourselves.
 *
 * **It returns React nodes, never an HTML string.** There is no `dangerouslySetInnerHTML`
 * anywhere in this file, so escaping is structural rather than something to remember:
 * React escapes text children, and markdown that came back from a model with an
 * `<img onerror=…>` in it renders as those literal characters. That matters more here
 * than in a typical content site, because this text originates from a language model
 * reading untrusted repositories.
 *
 * Anything outside the known set renders as plain text rather than being silently
 * dropped, so an unexpected construct is visible rather than invisible.
 */

/** Splits a line into text, bold and code runs. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass over both markers, so `**a `b` c**` does not need nesting rules we do not
  // emit anyway.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));

    const token = match[0];
    const key = `${keyPrefix}-i${String(index)}`;
    index += 1;

    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** True for a pipe-table separator row, e.g. `| --- | --- |`. */
function isSeparator(line: string): boolean {
  return /^\|[\s|:-]+\|$/.test(line.trim()) && line.includes('-');
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function Markdown({
  source,
  headingOffset = 0,
}: {
  source: string;
  headingOffset?: number;
}) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  // The most recent heading, so a table can be named after the section it sits in.
  let lastHeading = 'Document';

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    const k = `b${String(key)}`;
    key += 1;

    // Headings -----------------------------------------------------------
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      // Shifted so a document embedded in a page does not claim the page's own h1:
      // the thread title is the page heading, and two h1s tell a screen reader the
      // page has two subjects.
      const level = Math.min(6, (heading[1]?.length ?? 1) + headingOffset);
      const text = heading[2] ?? '';
      lastHeading = text;
      const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[level - 1] ?? 'h6';
      blocks.push(<Tag key={k}>{inline(text, k)}</Tag>);
      i += 1;
      continue;
    }

    // Tables --------------------------------------------------------------
    if (trimmed.startsWith('|') && isSeparator(lines[i + 1] ?? '')) {
      const header = cells(trimmed);
      const rows: string[][] = [];
      let j = i + 2;

      while (j < lines.length && (lines[j] ?? '').trim().startsWith('|')) {
        rows.push(cells(lines[j] ?? ''));
        j += 1;
      }

      blocks.push(
        <ScrollRegion className="doc__tableWrap" key={k} label={`${lastHeading} table`}>
          <table className="doc__table">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={`${k}-h${String(index)}`} scope="col">
                    {inline(cell, `${k}-h${String(index)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${k}-r${String(rowIndex)}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${k}-r${String(rowIndex)}c${String(cellIndex)}`}>
                      {inline(cell, `${k}-r${String(rowIndex)}c${String(cellIndex)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>,
      );

      i = j;
      continue;
    }

    // Lists ---------------------------------------------------------------
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      let j = i;

      while (j < lines.length && /^[-*]\s+/.test((lines[j] ?? '').trim())) {
        items.push((lines[j] ?? '').trim().replace(/^[-*]\s+/, ''));
        j += 1;
      }

      blocks.push(
        <ul className="doc__list" key={k}>
          {items.map((item, index) => (
            <li key={`${k}-l${String(index)}`}>{inline(item, `${k}-l${String(index)}`)}</li>
          ))}
        </ul>,
      );

      i = j;
      continue;
    }

    // Paragraph -----------------------------------------------------------
    // Consecutive non-blank lines that are not another construct form one paragraph,
    // matching how the renderers wrap prose.
    const paragraph: string[] = [];
    let j = i;

    while (j < lines.length) {
      const candidate = (lines[j] ?? '').trim();
      if (
        candidate.length === 0 ||
        /^(#{1,4})\s+/.test(candidate) ||
        candidate.startsWith('|') ||
        /^[-*]\s+/.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      j += 1;
    }

    blocks.push(<p key={k}>{inline(paragraph.join(' '), k)}</p>);
    i = j;
  }

  return <>{blocks}</>;
}
