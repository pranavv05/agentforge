/** Thin typed wrappers over the public (no-login, side-effect-free) Hono endpoints. */
export type Verdict = { ok: boolean; reason?: string }
export type Explain = { title: string; why: string; fix: string; alt: { file: string; line_start: number; line_end: number } | null } | null

export async function postJson<T = any>(url: string, body: unknown, fallback: T): Promise<T> {
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const j = await r.json().catch(() => null)
    return j && r.status < 500 ? (j as T) : fallback
  } catch {
    return fallback
  }
}

const fileCache = new Map<string, Promise<string[] | null>>()
export function loadFile(path: string): Promise<string[] | null> {
  if (!fileCache.has(path)) {
    fileCache.set(
      path,
      fetch('/api/public/file?path=' + encodeURIComponent(path))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d ? (d.content as string).split('\n') : null))
        .catch(() => null),
    )
  }
  return fileCache.get(path)!
}

export type ClaimRes = { verdict: Verdict; explain: Explain }
export const checkClaim = (file: string, line_start: number, line_end: number, symbol: string) =>
  postJson<ClaimRes>('/api/public/claim', { file, line_start, line_end, symbol }, { verdict: { ok: true, reason: 'ok' }, explain: null })

export const checkTransition = (from: string, to: string, actor: string) =>
  postJson<{ ok: boolean; code?: string; http?: number; message?: string }>('/api/public/transition', { from, to, actor }, { ok: actor !== 'agent', message: 'offline' })

export const checkHook = (status: string, tool: string) =>
  postJson<{ decision: string; exit_code: number; reason?: string }>('/api/public/hook', { status, tool }, { decision: status === 'READY_FOR_IMPLEMENTATION' ? 'allow' : 'deny', exit_code: status === 'READY_FOR_IMPLEMENTATION' ? 0 : 2 })

export const checkLint = (text: string) =>
  postJson<{ ok: boolean; hits: { match: string }[] }>('/api/public/lint', { text }, { ok: false, hits: [{ match: '194J' }] })
