'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { SpecMode, SpecState } from '@agentforge/contract';
import { SignOutButton } from '@/components/workspace/sign-out';
import { ThemeToggle } from '@/components/workspace/theme-toggle';
import { labelFor, toneFor } from '@/components/workspace/status';

/**
 * The thread rail.
 *
 * Threads a reviewer owes a decision on float to the top and carry a pip, because that
 * is the only question this list is ever scanned for. Everything else keeps its
 * chronological order, which is how people remember their own work.
 *
 * A client component purely so the current thread can be marked with `aria-current`
 * without the server having to know the route.
 */

export interface RailThread {
  readonly id: string;
  readonly title: string;
  readonly status: SpecState;
  readonly mode: SpecMode;
  readonly awaiting: boolean;
}

export function Rail({
  threads,
  user,
}: {
  threads: readonly RailThread[];
  user: { readonly name: string; readonly role: string };
}) {
  const params = useParams<{ id?: string }>();
  const currentId = params.id;

  const waiting = threads.filter((thread) => thread.awaiting);
  const rest = threads.filter((thread) => !thread.awaiting);

  const item = (thread: RailThread) => (
    <Link
      className="rail__item"
      key={thread.id}
      href={`/workspace/${thread.id}`}
      aria-current={thread.id === currentId ? 'page' : undefined}
    >
      <span className="rail__title">
        {thread.awaiting && <span className="rail__pip" aria-hidden="true" />}
        {thread.title}
      </span>
      <span className={`rail__meta rail__meta--${toneFor(thread.status)}`}>
        {labelFor(thread.status)}
      </span>
    </Link>
  );

  return (
    <nav className="rail" aria-label="Threads">
      <div className="rail__top">
        <Link className="rail__brand" href="/">
          <span className="rail__mark" aria-hidden="true" />
          AgentForge
        </Link>

        <Link className="rail__new" href="/workspace">
          <span aria-hidden="true">+</span> New spec
        </Link>
      </div>

      <div className="rail__list">
        {threads.length === 0 && (
          <div className="rail__empty">
            <p className="rail__emptyTitle">Nothing here yet</p>
            <p className="rail__emptyBody">
              Every spec you start appears here, with a dot when it is waiting on you.
            </p>
          </div>
        )}

        {waiting.length > 0 && (
          <>
            <p className="rail__section">Waiting on you</p>
            {waiting.map(item)}
          </>
        )}

        {rest.length > 0 && (
          <>
            {waiting.length > 0 && <p className="rail__section">All threads</p>}
            {rest.map(item)}
          </>
        )}
      </div>

      <div className="rail__foot">
        <span className="rail__who">
          <span className="rail__name">{user.name}</span>
          <span className="rail__role">{user.role}</span>
        </span>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </nav>
  );
}
