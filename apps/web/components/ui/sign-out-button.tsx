'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

/**
 * Sign out.
 *
 * A button rather than a link, because it changes server state. `router.refresh()` runs
 * before the navigation so the server components re-render without the session — without
 * it, the cached signed-in render would still be in memory and the app shell would flash
 * the previous user's name on the way out.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick(): Promise<void> {
    setPending(true);
    await signOut();
    router.refresh();
    router.push('/sign-in');
  }

  return (
    <button
      className="app__signOut"
      type="button"
      onClick={() => {
        void onClick();
      }}
      disabled={pending}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
