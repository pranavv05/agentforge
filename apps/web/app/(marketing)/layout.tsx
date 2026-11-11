import type { ReactNode } from 'react';
import Link from 'next/link';
import { NavChrome } from '@/components/motion/nav-chrome';
import { SmoothScroll } from '@/components/motion/smooth-scroll';
import './marketing.css';

/**
 * The marketing shell.
 *
 * This is the one surface that gets the full motion treatment — smooth scrolling,
 * scroll-driven reveals, split headlines. The application side gets none of it, on
 * purpose: someone approving a tax-compliance document needs the interface to hold
 * still, and the frontend definition of done asks for no layout shift and full keyboard
 * navigation. A landing page and a review tool are different jobs.
 */

const NAV = [
  { href: '#governance', label: 'Governance' },
  { href: '#evidence', label: 'Evidence' },
  { href: '#compliance', label: 'Compliance' },
  { href: '#measured', label: 'Measured' },
] as const;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing">
      <SmoothScroll />
      <NavChrome />

      <header className="nav">
        <div className="nav__inner shell">
          <Link className="wordmark nav__brand" href="/">
            <span className="mark" aria-hidden="true" />
            AgentForge
          </Link>

          <nav className="nav__links" aria-label="Sections">
            {NAV.map((item) => (
              <a key={item.href} className="nav__link" href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="nav__actions">
            <Link className="nav__link nav__link--quiet" href="/sign-in">
              Sign in
            </Link>
            <Link className="btn btn--primary btn--sm" href="/sign-up">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="foot">
        <div className="shell foot__inner">
          <div className="wordmark">
            <span className="mark" aria-hidden="true" />
            AgentForge
          </div>

          <p className="foot__note">
            An agentic spec-driven development platform. Stage transitions are owned by a
            deterministic orchestrator; approvals bind to a content hash; every claim about existing
            code is verified before it reaches a document.
          </p>

          <div className="foot__meta">
            <Link className="foot__link" href="/sign-in">
              Sign in
            </Link>
            <a
              className="foot__link"
              href="https://github.com/pranavv05/agentforge"
              rel="noreferrer noopener"
              target="_blank"
            >
              Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
