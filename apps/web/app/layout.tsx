import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentForge',
  description: 'Agentic spec-driven development with server-enforced governance.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <a className="brand" href="/">
            AgentForge
          </a>
          <span className="tagline">evidence-checked specs, server-enforced gates</span>
          <a href="/groundwork">Groundwork site</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
