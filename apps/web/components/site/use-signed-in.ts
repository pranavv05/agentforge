'use client';

import { useSession } from '@/lib/auth-client';

/**
 * Whether the visitor is signed in, as a plain boolean.
 *
 * The landing page arrived with its own session hook that fetched `/api/session` — an
 * endpoint this app does not have — and cached the answer in a module variable. This
 * replaces it with the Better Auth client the rest of the app already uses, so there is
 * one source of truth for "is anyone signed in" rather than two that can disagree.
 *
 * It reports `false` while the session is still loading. On this page that is the right
 * default: the only thing it changes is whether the nav says "Sign in" or "Open
 * dashboard", and briefly showing the signed-out nav to someone signed in is a much
 * smaller error than showing a dashboard link to someone who would land on a redirect.
 */
export function useSignedIn(): boolean {
  const { data, isPending } = useSession();
  return !isPending && data !== null;
}
