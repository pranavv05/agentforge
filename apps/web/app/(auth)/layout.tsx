import type { ReactNode } from 'react';
import Link from 'next/link';
import './auth.css';

/**
 * The auth shell.
 *
 * A single centred card on the paper ground, with the product's argument restated beside
 * it. The restatement is not filler: signing in is the moment the audit log starts being
 * able to name you, and saying so is more useful than a stock illustration.
 *
 * No smooth scrolling and no scroll animation here. The page does not scroll.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__panel">
        <Link className="wordmark auth__brand" href="/">
          <span className="mark" aria-hidden="true" />
          AgentForge
        </Link>

        {children}
      </div>

      <aside className="auth__aside" aria-label="About AgentForge">
        <blockquote className="auth__quote">
          <p>
            Approvals bind to a content hash, and the audit log records who signed off on exactly
            which bytes.
          </p>
          <footer className="auth__quoteFoot">
            That record is only worth something if it names a person — which is what an account is
            for.
          </footer>
        </blockquote>

        <dl className="auth__facts">
          <div>
            <dt>Transitions</dt>
            <dd>Owned by one function. All 225 ordered state pairs tested.</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>
              Every codebase claim carries a <code>file:line</code> reference that deterministic
              code verifies.
            </dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>Append-only at the database level. Even direct SQL cannot rewrite it.</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
