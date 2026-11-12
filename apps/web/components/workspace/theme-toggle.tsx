'use client';

import { useEffect, useState } from 'react';

/**
 * Light or dark, remembered.
 *
 * Three states rather than two: light, dark, or follow the system. "Follow the system"
 * is the default and is not a cosmetic nicety — someone whose machine switches at dusk
 * should not have this one app stay bright, and someone who has never touched this
 * control should never have been asked.
 *
 * The choice is stored per browser in `localStorage` and applied to the document
 * element, where `workspace.css` reads it. Nothing is sent to the server: a theme is not
 * an account setting, and making it one would mean a round trip before first paint.
 */

const KEY = 'agentforge-theme';

type Choice = 'system' | 'light' | 'dark';

function isChoice(value: string | null): value is Choice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Reads the stored choice. Private windows and blocked storage both read as 'system'. */
function stored(): Choice {
  try {
    const value = window.localStorage.getItem(KEY);
    return isChoice(value) ? value : 'system';
  } catch {
    // Storage can throw outright, not merely return null, when site data is blocked.
    // A theme preference is not worth an exception propagating out of a render.
    return 'system';
  }
}

function apply(choice: Choice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };

const LABEL: Record<Choice, string> = {
  system: 'Theme: follows your system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

/** A sun, a moon, or a half-filled circle for "follow the system". */
function Icon({ choice }: { choice: Choice }) {
  if (choice === 'light') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1="8"
            y1="1.4"
            x2="8"
            y2="3.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            transform={`rotate(${String(deg)} 8 8)`}
          />
        ))}
      </svg>
    );
  }

  if (choice === 'dark') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.6a5.4 5.4 0 0 1 0 10.8Z" fill="currentColor" />
    </svg>
  );
}

export function ThemeToggle() {
  // Starts at 'system' on both server and client so the first client render matches the
  // HTML. The real choice is read in the effect below; the inline script in the layout
  // has already applied it to the document, so the page itself never flashes.
  const [choice, setChoice] = useState<Choice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChoice(stored());
    setReady(true);
  }, []);

  function cycle(): void {
    const next = NEXT[choice];
    setChoice(next);
    apply(next);

    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // The theme still applies for this page; it simply will not be remembered. That
      // is a better outcome than refusing to switch at all.
    }
  }

  return (
    <button
      className="themeBtn"
      type="button"
      onClick={cycle}
      // Until the stored choice is read, the icon would be wrong for anyone who chose
      // dark. Hiding the label from assistive tech for that instant is better than
      // announcing the wrong state.
      aria-label={ready ? `${LABEL[choice]}. Change theme.` : 'Change theme'}
      title={ready ? LABEL[choice] : undefined}
    >
      <Icon choice={choice} />
    </button>
  );
}
