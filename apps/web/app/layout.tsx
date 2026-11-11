import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * The root layout.
 *
 * Deliberately thin: it sets the document, the fonts and the skip link, and nothing
 * else. The three route groups each bring their own chrome, because they want very
 * different things — `(marketing)` is a full-bleed canvas with smooth scrolling,
 * `(app)` is a working interface with a persistent sidebar, and `(auth)` is a single
 * centred card. Putting a header here would mean every one of them fighting it.
 */

export const metadata: Metadata = {
  title: {
    default: 'AgentForge — governance that holds',
    template: '%s · AgentForge',
  },
  description:
    'Agentic spec-driven development with server-enforced gates, evidence-checked ' +
    'brownfield specs, and compliance rules as testable acceptance criteria.',
  applicationName: 'AgentForge',
  authors: [{ name: 'AgentForge' }],
  openGraph: {
    title: 'AgentForge — governance that holds',
    description:
      'Approvals bind to a content hash. Every claim about your code carries a ' +
      'file:line reference that deterministic code verifies.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The warm paper ground, so the browser chrome matches the page instead of flashing
  // white on load.
  themeColor: '#f8f7f3',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
