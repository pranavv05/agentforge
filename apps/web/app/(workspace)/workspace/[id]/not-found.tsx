import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Spec not found',
};

/**
 * A spec that does not exist.
 *
 * Reached by a mistyped or stale link, or by following one to a spec that has since been
 * removed. Without this a visitor got the framework's bare 404, which sits outside the
 * workspace chrome and offers no way back — so it renders inside the workspace, with the
 * thread list still on screen, and says what to do next.
 */
export default function SpecNotFound() {
  return (
    <main id="main" tabIndex={-1} className="stage">
      <div className="empty">
        <div className="empty__inner">
          <h1 className="empty__title">We can’t find that spec</h1>
          <p className="empty__lede">
            The link may be wrong, or the spec may have been removed. Your other threads are in the
            list, and nothing has been changed by landing here.
          </p>

          <div className="empty__actions">
            <Link className="btn btn--accent" href="/workspace">
              Start a new spec
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
