import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@agentforge/db';
import { listSpecs } from '@agentforge/orchestrator';
import { isAwaitingHuman } from '@agentforge/contract';
import { getAuth } from '@/lib/auth';
import { Rail } from '@/components/workspace/rail';
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
    <div className="ws">
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
  );
}
