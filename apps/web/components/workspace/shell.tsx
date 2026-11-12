'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Rail, type RailThread } from '@/components/workspace/rail';

/**
 * The workspace frame: thread rail, and on a phone, the drawer that holds it.
 *
 * At desktop width the rail is simply the first column and this component adds nothing.
 * Below the breakpoint it becomes an off-canvas drawer behind a top bar, because the
 * stacked arrangement it replaces gave the thread list around 60% of a phone screen
 * before the conversation started — shrinking a sidebar does not fix a layout whose
 * problem is that it is a sidebar.
 *
 * The drawer is a disclosure, not a modal: it closes on Escape, on choosing a thread,
 * and on tapping the scrim, and focus returns to the button that opened it. It is not a
 * focus trap, because it does not claim to make the page behind it inert — the scrim is
 * a tap target, not a barrier — and a trap that fails to trap is worse than none.
 */
export function Shell({
  threads,
  user,
  children,
}: {
  threads: readonly RailThread[];
  user: { readonly name: string; readonly role: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  // Escape closes, and focus goes back to where the user was.
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening moves focus into the drawer; otherwise a keyboard user opens a menu and is
  // still tabbing through the page behind it.
  useEffect(() => {
    if (open) rail.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);

  return (
    <>
      <header className="mbar">
        <button
          ref={toggle}
          className="mbar__menu"
          type="button"
          aria-expanded={open}
          aria-controls="thread-rail"
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M3 5.5h14M3 10h14M3 14.5h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="visually-hidden">Threads</span>
        </button>

        <Link className="mbar__brand" href="/workspace">
          <span className="rail__mark" aria-hidden="true" />
          AgentForge
        </Link>

        <Link className="mbar__new" href="/workspace">
          <span aria-hidden="true">+</span> New
        </Link>
      </header>

      <div
        id="thread-rail"
        ref={rail}
        className={`railWrap${open ? ' is-open' : ''}`}
        // Choosing a thread is navigation, so the drawer gets out of the way. Handled
        // here, once, rather than with a route listener that would also need a Suspense
        // boundary for the search params.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {/* Shown by the phone stylesheet only. The drawer covers the top bar, so without
            its own close control the only way out by touch is tapping the scrim, which
            nothing on screen says you can do. */}
        <div className="railWrap__head">
          <span className="railWrap__title">Threads</span>
          <button
            className="railWrap__close"
            type="button"
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span className="visually-hidden">Close threads</span>
          </button>
        </div>
        <Rail threads={threads} user={user} />
      </div>

      {open && (
        <button
          className="scrim"
          type="button"
          tabIndex={-1}
          aria-label="Close threads"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}

      {children}
    </>
  );
}
