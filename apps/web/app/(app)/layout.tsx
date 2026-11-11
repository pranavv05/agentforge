import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from '@/lib/auth';
import { SignOutButton } from '@/components/ui/sign-out-button';
import './app.css';

/**
 * The application shell.
 *
 * **This layout is the page-level auth gate.** `handle()` protects the API, but a page
 * is not an API route: `/specs` is a server component that reads the database directly,
 * so without a check here it would render a signed-out visitor the full spec list. Doing
 * it in the layout rather than in each page means a new screen added under `(app)` is
 * protected by existing, not by remembering.
 *
 * No smooth scrolling, no scroll-triggered animation, no split headlines. This is where
 * someone reads a compliance document and decides whether to approve it; the interface
 * needs to hold still. Motion here is limited to state feedback — a pending button, a
 * row that highlights — and that is a deliberate split from the marketing surface, not
 * an omission.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });

  if (session === null) {
    redirect('/sign-in');
  }

  const role = (session.user as { role?: unknown }).role;

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__barInner">
          <Link className="wordmark app__brand" href="/specs">
            <span className="mark" aria-hidden="true" />
            AgentForge
          </Link>

          <nav className="app__nav" aria-label="Main">
            <Link className="app__navLink" href="/specs">
              Specs
            </Link>
            <Link className="app__navLink" href="/compliance">
              Compliance pack
            </Link>
          </nav>

          <div className="app__user">
            <span className="app__userName">
              {session.user.name}
              <span className="app__userRole">
                {typeof role === 'string' && role.length > 0 ? role : 'reviewer'}
              </span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="app__body">{children}</div>
    </div>
  );
}
