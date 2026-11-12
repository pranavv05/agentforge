import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentHash } from '@/components/workspace/hash';
import { Markdown } from '@/components/ui/markdown';
import { authPage } from '@/lib/site/auth';
import { footer, nav } from '@/lib/site/layout';
import { labelFor, toneFor } from '@/components/workspace/status';
import { SPEC_STATES } from '@agentforge/contract';

/**
 * Accessibility regressions that can be checked without a browser.
 *
 * The real audit ran axe-core against the live pages in a browser, and found problems
 * no unit test would have: contrast, focusability, landmark structure. That cannot run
 * in CI here, so these tests pin the *structural* decisions that audit led to — the ones
 * that are properties of the markup rather than of how it renders — so they do not
 * quietly regress.
 *
 * Contrast and focus behaviour are deliberately not asserted here. A test that claimed
 * to check them without a rendering engine would be giving false comfort.
 */

describe('the content hash control', () => {
  const html = renderToStaticMarkup(createElement(ContentHash, { value: 'a'.repeat(64) }));

  it('is named by its visible text, not by an aria-label that hides it', () => {
    // WCAG 2.5.3: a control whose accessible name does not contain its visible label
    // breaks voice control, because "click copy" finds nothing. It used to carry an
    // aria-label that started with different words.
    expect(html).not.toMatch(/<button[^>]*aria-label/);
    expect(html).toContain('copy');
  });

  it('still exposes the full hash, as a description rather than the name', () => {
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('a'.repeat(64));
  });
});

describe('document headings inside the workspace', () => {
  it('never claim the page h1 when embedded', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { source: '# Title\n\n## Section', headingOffset: 1 }),
    );

    expect(html).not.toContain('<h1>');
  });

  it('wrap tables in a region that is only focusable once it overflows', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        source: ['## Traceability', '', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      }),
    );

    // Server-rendered, nothing has been measured, so it must not be a tab stop yet. A
    // document with ten tables used to put ten identical stops in the tab order.
    expect(html).toContain('doc__tableWrap');
    expect(html).not.toContain('tabindex');
  });
});

describe('status labels', () => {
  it('give every state a plain-English label and a tone', () => {
    // The rail and the header both read these. A state missing a label would render as
    // `undefined` in the sidebar, which is how a new state would first be noticed.
    for (const state of SPEC_STATES) {
      expect(labelFor(state).length, state).toBeGreaterThan(2);
      expect(toneFor(state), state).toMatch(/^(wait|live|done|calm|fail)$/);
    }
  });

  it('only calls a state "wait" when a human is the one being waited on', () => {
    for (const state of SPEC_STATES) {
      if (toneFor(state) === 'wait') {
        expect(labelFor(state).toLowerCase(), state).toMatch(/review|answers/);
      }
    }
  });
});

describe('the sign-in and sign-up pages', () => {
  for (const mode of ['login', 'signup'] as const) {
    const html = authPage(mode);

    it(`${mode}: has a main landmark and exactly one h1`, () => {
      expect(html).toContain('<main');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    });

    it(`${mode}: does not skip a heading level`, () => {
      // The decorative example card used an h4 directly under the h1.
      expect(html).not.toContain('<h4');
      expect(html).not.toContain('<h3');
    });

    it(`${mode}: labels the example panel rather than leaving it a bare region`, () => {
      expect(html).toMatch(/<aside[^>]*aria-label=/);
    });

    it(`${mode}: has no empty table header`, () => {
      expect(html).not.toContain('<th></th>');
    });
  }
});

describe('the shared marketing chrome', () => {
  it('uses real headings for footer columns, not h6', () => {
    const html = footer();

    // An h6 straight after an h2 put a level-six heading on every page.
    expect(html).not.toContain('<h6');
    expect(html).toContain('<h2 class="gh">Product</h2>');
  });

  it('has no empty heading in the navigation', () => {
    // The dropdown used `<h6>&nbsp;</h6>` for spacing.
    expect(nav(false)).not.toMatch(/<h[1-6][^>]*>(\s|&nbsp;)*<\/h[1-6]>/);
  });
});
