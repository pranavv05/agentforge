import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/ui/markdown';

/**
 * The markdown renderer, against hostile input.
 *
 * This matters more here than on a typical content site. The documents it renders are
 * written by a language model that has just read an untrusted repository — one that may
 * contain a `CLAUDE.md`, a comment or a filename crafted to get something through. The
 * component's claim is that escaping is *structural*: it returns React nodes and never
 * an HTML string, so there is no sanitiser to get wrong and no `dangerouslySetInnerHTML`
 * to forget.
 *
 * These tests hold it to that by rendering to static markup and checking the dangerous
 * constructs come out as visible text rather than live markup.
 */

function render(source: string): string {
  // `createElement` rather than JSX: this suite runs through the shared vitest config,
  // which has no JSX transform, and adding one for a single file was not worth the
  // toolchain surface.
  return renderToStaticMarkup(createElement(Markdown, { source }));
}

describe('untrusted content cannot become markup', () => {
  it('renders a script tag as text', () => {
    const html = render('A finding about <script>alert(1)</script> the parser.');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an image with an inline handler as text', () => {
    const html = render('See <img src=x onerror="fetch(\'//evil\')"> here.');

    // No live element is what matters. The characters "onerror=" do appear — as visible
    // text inside escaped content — and asserting they are absent would be testing the
    // wrong thing: the attack is a parsed attribute on a real tag, not a string.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&quot;');
  });

  it('does not let a crafted file path open a tag', () => {
    // The kind of thing a filename in a scanned repository could carry into a citation.
    const html = render('- `src/<iframe src=//evil>.ts` — verified');

    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;iframe');
  });

  it('keeps a javascript: URL inert, because links are never constructed', () => {
    // The renderer has no link syntax at all, so a URL is text wherever it appears.
    const html = render('[click](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('javascript:alert(1)');
  });

  it('escapes inside a table cell, where values are least inspected', () => {
    const html = render(
      ['| ID | Then |', '| --- | --- |', '| AC-001 | <script>x</script> |'].join('\n'),
    );

    expect(html).toContain('<td>');
    expect(html).not.toContain('<script>');
  });
});

describe('the supported subset renders', () => {
  it('builds headings, lists and tables', () => {
    const html = render(
      [
        '# Requirements',
        '',
        'Some prose.',
        '',
        '## Non-goals',
        '',
        '- Live IRP submission',
        '',
        '| ID | Given |',
        '| --- | --- |',
        '| AC-001 | a finalised invoice |',
      ].join('\n'),
    );

    expect(html).toContain('<h1>Requirements</h1>');
    expect(html).toContain('<h2>Non-goals</h2>');
    expect(html).toContain('<li>Live IRP submission</li>');
    expect(html).toContain('<th scope="col">ID</th>');
    expect(html).toContain('a finalised invoice');
  });

  it('renders bold and inline code', () => {
    const html = render('**Statement.** The system shall emit `GST JSON`.');

    expect(html).toContain('<strong>Statement.</strong>');
    expect(html).toContain('<code>GST JSON</code>');
  });

  it('shows an unsupported construct as text rather than dropping it', () => {
    // Silently swallowing something a model wrote would hide content from a reviewer
    // who is about to approve it.
    const html = render('> a blockquote the renderer has no rule for');

    expect(html).toContain('a blockquote the renderer has no rule for');
  });

  it('shifts headings down so an embedded document does not claim the page h1', () => {
    // The thread title is the page's h1. A document pane that also emitted an h1 would
    // tell a screen reader the page has two subjects.
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        source: ['# Requirements', '', '## Non-goals'].join('\n'),
        headingOffset: 1,
      }),
    );

    expect(html).toContain('<h2>Requirements</h2>');
    expect(html).toContain('<h3>Non-goals</h3>');
    expect(html).not.toContain('<h1>');
  });

  it('clamps at h6 rather than inventing a level', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { source: '#### Deep', headingOffset: 5 }),
    );

    expect(html).toContain('<h6>Deep</h6>');
  });

  it('survives an empty document', () => {
    expect(render('')).toBe('');
  });
});
