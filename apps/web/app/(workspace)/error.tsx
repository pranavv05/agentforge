'use client';

import Link from 'next/link';

/**
 * Something threw while rendering a workspace page.
 *
 * Without this a thrown error — the database file locked, a malformed stored row failing
 * its schema check — replaced the whole screen with a blank page and a stack trace in the
 * console. The user could not tell whether their work was lost.
 *
 * It says the true thing, which is also the reassuring thing: this page failed to
 * *display*. Nothing here writes, so a render failure cannot have changed a spec, and the
 * audit log is append-only regardless. The digest is the reference to quote, since the
 * message itself can contain paths and is deliberately not shown.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" tabIndex={-1} className="stage">
      <div className="empty" role="alert">
        <div className="empty__inner">
          <h1 className="empty__title">This page failed to load</h1>
          <p className="empty__lede">
            Something went wrong while showing it. Nothing was changed by this — a page that fails
            to display cannot alter a spec, and the audit trail is append-only either way.
          </p>

          {error.digest !== undefined && (
            <p className="errnote__ref">
              Reference <code>{error.digest}</code>
            </p>
          )}

          <div className="empty__actions">
            <button className="btn btn--accent" type="button" onClick={reset}>
              Try again
            </button>
            <Link className="btn" href="/workspace">
              Back to the workspace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
