'use client';

import { useEffect, useState } from 'react';

/**
 * A polite live region for the whole workspace.
 *
 * Most of what this tool does happens somewhere other than where the user's attention
 * is: a draft finishes, a decision is recorded, the page re-renders underneath them.
 * Sighted users see the thread change. Screen-reader users get nothing, because a
 * region that changes without being announced is, for them, a region that did not
 * change.
 *
 * One region for the whole app rather than one per component, because assistive tech
 * announces changes to a live region and two regions updating at once talk over each
 * other. Anything that wants to say something calls `announce()`.
 */

const EVENT = 'agentforge:announce';

/** Says something to assistive technology. Safe to call from anywhere on the client. */
export function announce(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/**
 * Moves focus to the page's main region.
 *
 * Used after an action that removes the control the user was on — approving a document
 * unmounts the approve button, and focus otherwise falls back to `<body>`, which for a
 * keyboard user means starting again from the top of the page.
 */
export function focusMain(): void {
  document.getElementById('main')?.focus({ preventScroll: true });
}

export function Announcer() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onAnnounce = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      // Cleared first. Setting identical text twice produces no DOM change, and so no
      // announcement: "Draft started" a second time would be silent.
      setMessage('');
      window.setTimeout(() => {
        setMessage(event.detail as string);
      }, 40);
    };

    window.addEventListener(EVENT, onAnnounce);
    return () => {
      window.removeEventListener(EVENT, onAnnounce);
    };
  }, []);

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
