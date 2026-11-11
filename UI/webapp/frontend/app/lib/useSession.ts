'use client'
import { useEffect, useState } from 'react'

let cached: Promise<boolean> | null = null
/** Signed-in state, resolved client-side so the landing page can stay a fully static export. */
export function useSession(): boolean {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    cached ??= fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !!d?.signedIn)
      .catch(() => false)
    let live = true
    cached.then((v) => live && setSignedIn(v))
    return () => { live = false }
  }, [])
  return signedIn
}
