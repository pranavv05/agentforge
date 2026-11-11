import { redirect } from 'next/navigation';

/**
 * `/specs` — kept as a redirect.
 *
 * The workspace moved to `/workspace`, but the auth screens are the frontend track's and
 * may still send people here after signing in. A redirect costs nothing and means a
 * stale destination is a detour rather than a 404 on the first screen after login.
 */
export default function SpecsRedirect(): never {
  redirect('/workspace');
}
