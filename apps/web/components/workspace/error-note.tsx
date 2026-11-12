'use client';

import { useRouter } from 'next/navigation';
import type { ErrorExplanation } from '@/components/workspace/explain-error';

/**
 * A failure, with a way out.
 *
 * Replaces four copies of `<p role="alert">{message}</p>`, which told you something went
 * wrong and left you to work out what to do. Where there is a next step it is a button,
 * because "reload to see where it got to" is not helpful as a sentence you must act on
 * yourself.
 *
 * `role="alert"` is deliberate and is the one place it is right: this appears in direct
 * response to something the user just did, so it should interrupt.
 */
export function ErrorNote({
  error,
  className,
  onRetry,
}: {
  error: ErrorExplanation;
  className: string;
  onRetry?: () => void;
}) {
  const router = useRouter();

  return (
    <div className={`${className} errnote`} role="alert">
      <p className="errnote__msg">{error.message}</p>

      {(error.action === 'reload' ||
        error.action === 'sign-in' ||
        (error.action === 'retry' && onRetry !== undefined)) && (
        <div className="errnote__actions">
          {error.action === 'reload' && (
            <button
              className="errnote__btn"
              type="button"
              onClick={() => {
                router.refresh();
              }}
            >
              Reload
            </button>
          )}

          {error.action === 'retry' && onRetry !== undefined && (
            <button className="errnote__btn" type="button" onClick={onRetry}>
              Try again
            </button>
          )}

          {error.action === 'sign-in' && (
            <button
              className="errnote__btn"
              type="button"
              onClick={() => {
                // Back to this exact page afterwards. The sign-in page only honours a
                // path under /workspace for `next`, so this cannot be turned into an
                // open redirect by editing the URL.
                const next = window.location.pathname + window.location.search;
                window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`);
              }}
            >
              Sign in
            </button>
          )}
        </div>
      )}

      {error.reference !== null && (
        <p className="errnote__ref">
          Reference <code>{error.reference}</code>
        </p>
      )}
    </div>
  );
}
