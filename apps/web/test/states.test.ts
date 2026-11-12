import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspaceError from '@/app/(workspace)/error';
import SpecNotFound from '@/app/(workspace)/workspace/[id]/not-found';
import Loading from '@/app/(workspace)/workspace/[id]/loading';
import { ExamplePrompts, PREFILL_EVENT } from '@/components/workspace/example-prompts';

/**
 * The screens nobody designs until someone hits them.
 *
 * The workspace had no `loading`, `error` or `not-found` file at all: a bad URL got the
 * framework's bare 404 outside the workspace chrome, and a thrown error blanked the page
 * with a stack trace in the console where the user could not see it — leaving them unable
 * to tell whether their work was lost. These tests pin what each of those screens must
 * say, because the reassurance in them is a claim, and a claim should not drift.
 */

describe('the error boundary', () => {
  const error = Object.assign(new Error('SQLITE_BUSY: database is locked at D:\\secret\\path'), {
    digest: 'dig-4821',
  });
  const html = renderToStaticMarkup(createElement(WorkspaceError, { error, reset: vi.fn() }));

  it('is announced as an alert, because it replaces the page', () => {
    expect(html).toContain('role="alert"');
  });

  it('gives a way to recover and a way out', () => {
    expect(html).toContain('Try again');
    expect(html).toContain('href="/workspace"');
  });

  it('shows the digest to quote, never the message, which can contain paths', () => {
    expect(html).toContain('dig-4821');
    expect(html).not.toContain('SQLITE_BUSY');
    expect(html).not.toContain('secret');
  });

  it('tells the user nothing was changed, which is true of a render failure', () => {
    // A page that fails to display cannot have written anything, and the audit log is
    // append-only regardless. This is the reassurance the screen exists to give.
    expect(html).toContain('Nothing was changed');
  });
});

describe('the not-found screen', () => {
  const html = renderToStaticMarkup(createElement(SpecNotFound));

  it('renders as a real page with a single h1 and a path back', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Start a new spec');
    expect(html).toContain('href="/workspace"');
  });

  it('is a focus target, so a keyboard user lands somewhere real', () => {
    expect(html).toContain('id="main"');
    expect(html).toContain('tabindex="-1"');
  });
});

describe('the loading skeleton', () => {
  const html = renderToStaticMarkup(createElement(Loading));

  it('says it is loading to assistive technology and marks the region busy', () => {
    // A shimmer is invisible to a screen reader; without this the page is simply silent.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading the conversation');
  });
});

describe('the example prompts', () => {
  const html = renderToStaticMarkup(
    createElement(ExamplePrompts, { examples: ['First example', 'Second example'] }),
  );

  it('are buttons, not inert list items', () => {
    // They were plain <li>s that looked like suggestions and did nothing when clicked,
    // which teaches a new user on the first screen that the interface is decorative.
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toContain('type="button"');
  });

  it('are a labelled list', () => {
    expect(html).toContain('aria-label="Example requests"');
  });

  it('use an event name the composer also listens for', () => {
    expect(PREFILL_EVENT).toBe('agentforge:prefill');
  });
});
