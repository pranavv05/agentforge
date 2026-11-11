'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

/**
 * Sign out of the workspace.
 *
 * `router.refresh()` runs before the navigation so the server components re-render
 * without the session; otherwise the cached signed-in render stays in memory and the
 * rail flashes the previous user's name on the way out.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(): Promise<void> {
    setPending(true);
    await signOut();
    router.refresh();
    router.push('/sign-in');
  }

  return (
    <button
      className="rail__out"
      type="button"
      disabled={pending}
      onClick={() => {
        void run();
      }}
    >
      {pending ? '…' : 'Sign out'}
    </button>
  );
}
