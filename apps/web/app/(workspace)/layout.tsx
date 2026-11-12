import '@/app/globals.css';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { listSpecs } from '@agentforge/orchestrator';
import { isAwaitingHuman } from '@agentforge/contract';
import { getAuth } from '@/lib/auth';
import { Rail } from '@/components/workspace/rail';
import { Announcer } from '@/components/workspace/announcer';
import './workspace.css';

/**
 * The workspace shell.
 *
 * Also the page-level auth gate for everything under it: `handle()` protects the API,
 * but these are server components reading the database directly, so without a check here
 * a signed-out visitor would be served the whole thread list. Doing it in the layout
 * means a screen added later is protected by existing rather than by remembering.
 *
 * Rendered per request. It reads the session cookie and the live spec list, so there is
 * nothing here that could honestly be cached at build time.
 */

export const dynamic = 'force-dynamic';

/**
 * Reads the saved theme and sets it on the document before anything renders.
 *
 * Inline and tiny because it has to run before the first paint, not after a round trip.
 * It mirrors the three states the toggle writes: an explicit choice wins, and anything
 * else falls through to the `prefers-color-scheme` rules in `workspace.css`.
 */
const THEME_BOOT =
  "try{var t=localStorage.getItem('agentforge-theme');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session === null) redirect('/sign-in');

  const { specs } = listSpecs(getDb(), {
    status: null,
    mode: null,
    limit: 100,
    offset: 0,
  });

  const role = (session.user as { role?: unknown }).role;

  return (
    <>
      {/* Geist Mono, the same face the marketing site sets hashes and state names in.
          Inter is self-hosted; this is the one webfont the workspace fetches. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      {/* Applies the saved theme before the first paint. Without it someone who chose
          dark gets a white flash on every navigation, which is worse than no toggle. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />

      <div className="ws">
        <Announcer />
        <Rail
          threads={specs.map((spec) => ({
            id: spec.id,
            title: spec.title,
            status: spec.status,
            mode: spec.mode,
            awaiting: isAwaitingHuman(spec.status),
          }))}
          user={{
            name: session.user.name,
            role: typeof role === 'string' && role.length > 0 ? role : 'reviewer',
          }}
        />

        {children}
      </div>
    </>
  );
}
