/**
 * OAuth state, PKCE (RFC 7636, S256) and fingerprint (HMAC-SHA256) helpers on Web Crypto, shared by the calendar Edge
 * Functions.
 */

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random URL-safe token; 32 bytes gives 43 characters, a valid PKCE code verifier. */
export function randomUrlToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The S256 code challenge for a verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/** HMAC-SHA256 of `text` under `key`, as lowercase hex (connection fingerprints). */
export async function hmacSha256Hex(key: string, text: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text)))
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('')
}
