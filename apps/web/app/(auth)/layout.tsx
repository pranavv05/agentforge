import type { ReactNode } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import './auth.css';

/**
 * The auth shell.
 *
 * A single centred card on the paper ground, with the product's argument restated beside
 * it. The restatement is not filler: signing in is the moment the audit log starts being
 * able to name you, and saying so is more useful than a stock illustration.
 *
 * No smooth scrolling and no scroll animation here. The page does not scroll.
 *
 * An already-signed-in visitor is sent on rather than shown a sign-in form. Landing on
 * a login page while logged in reads as "your session expired", which is both wrong and
 * alarming on a tool whose records are attributed to you.
 */
/*
 * Rendered per request, never prerendered.
 *
 * This layout reads the session cookie to bounce an already-signed-in visitor, so its
 * output depends on who is asking. Without this, the build tries to statically export
 * /sign-in and /sign-up, which evaluates the auth config at build time — with
 * NODE_ENV=production and none of the runtime environment — and fails on the missing
 * session secret.
 */
export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session !== null) redirect('/specs');

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
