const enc = new TextEncoder()

export const toHex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export const fromHex = (h: string) =>
  new Uint8Array((h.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)))

export async function sha256(s: string) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return toHex(a)
}

export async function hashPassword(pw: string, saltHex?: string) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  // Workers cap PBKDF2 at 100k iterations
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256
  )
  return { hash: toHex(bits), salt: toHex(salt) }
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
