'use client';

import { useEffect, useId, useState } from 'react';

/**
 * The content hash an approval binds to.
 *
 * It was previously printed in full: sixty-four hex characters wrapped across a row,
 * which is unreadable and also unusable — nobody compares a hash by eye, they copy it
 * and diff it. So it shows the first twelve, and copying gives you all of it.
 *
 * It stays visible rather than being tucked away, because it is the thing the approval
 * is *about*. Someone recording a decision should be able to see that the bytes they
 * are binding to have an identity, even if they never read the digits.
 *
 * Accessibility: the button's name is its visible text, because a name that does not
 * contain what is on screen breaks voice control ("click copy" finds nothing). The full
 * value is attached as a description instead, so a screen-reader user can hear all of it
 * without the name becoming sixty-four characters long.
 */
export function ContentHash({ value, label = 'content hash' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const fullId = useId();

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Denied permission, or an insecure origin. The hash is still on screen and still
      // selectable; the only thing lost is the shortcut.
      setCopied(false);
    }
  }

  return (
    <div className="hashRow">
      <span className="hashRow__label">{label}</span>

      <button
        className="hashRow__value"
        type="button"
        onClick={() => void copy()}
        title={value}
        aria-describedby={fullId}
      >
        <code>{value.slice(0, 12)}</code>
        <span className="hashRow__ell" aria-hidden="true">
          …
        </span>
        <span className={`hashRow__state${copied ? ' is-on' : ''}`}>
          {copied ? 'copied' : 'copy'}
        </span>
      </button>

      <span id={fullId} className="visually-hidden">
        Full {label}: {value}
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? 'Content hash copied to the clipboard' : ''}
      </span>
    </div>
  );
}
