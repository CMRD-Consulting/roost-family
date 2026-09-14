/**
 * Deno-only wiring shared by the calendar Edge Functions: Supabase clients, the caller auth helpers, DNS resolution
 * for the ICS host checks, and the `CALENDAR_ALLOW_PRIVATE_HOSTS` switch. Everything testable lives in the plain
 * TypeScript modules next to this one.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createCallerAuth, type RpcClient } from './auth.ts'
import { fetchIcsText } from './icsFetch.ts'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const NO_SESSION = { persistSession: false, autoRefreshToken: false }

/** Service-role client: reads calendar tables and calls the svc_* wrappers. Never exposed to callers. */
export const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: NO_SESSION })

export const callerAuth = createCallerAuth(
  (authorization): RpcClient =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: NO_SESSION, global: { headers: { Authorization: authorization } } }),
)

/**
 * `CALENDAR_ALLOW_PRIVATE_HOSTS=1` lets ICS subscriptions reach private hosts over http and other ports. For local
 * verification against a fixture on the host only (supabase/functions/.env, which is git-ignored); off by default and
 * never set in production.
 */
export const allowPrivateHosts = Deno.env.get('CALENDAR_ALLOW_PRIVATE_HOSTS') === '1'

/** IPv4 and IPv6 addresses of a host; [] when neither resolves. */
export async function resolveHost(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([Deno.resolveDns(hostname, 'A'), Deno.resolveDns(hostname, 'AAAA')])
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

export function fetchIcs(url: URL, signal?: AbortSignal): Promise<string> {
  return fetchIcsText(url, { fetch, resolveHost, allowPrivateHosts, signal })
}

/** A PostgREST error as a thrown Error that keeps its SQLSTATE `code` (the message may echo arguments; never log it). */
export function rpcFailure(fn: string, error: { code?: string; message: string }): Error {
  return Object.assign(new Error(`${fn} failed`), { code: error.code })
}

export async function svc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw rpcFailure(fn, error)
  return data as T
}

/** The OAuth client for a provider, or null when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MS_CLIENT_ID`/`MS_CLIENT_SECRET` are unset. */
export function oauthClient(provider: 'google' | 'microsoft'): { clientId: string; clientSecret: string } | null {
  const prefix = provider === 'google' ? 'GOOGLE' : 'MS'
  const clientId = Deno.env.get(`${prefix}_CLIENT_ID`)?.trim()
  const clientSecret = Deno.env.get(`${prefix}_CLIENT_SECRET`)?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * The OAuth redirect URI registered with Google and Microsoft: `CALENDAR_OAUTH_REDIRECT_URI` when set (needed locally,
 * where SUPABASE_URL inside the runtime is not the browser-facing URL), else `${SUPABASE_URL}/functions/v1/calendar-oauth-callback`.
 */
export const oauthRedirectUri =
  Deno.env.get('CALENDAR_OAUTH_REDIRECT_URI')?.trim() || `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/calendar-oauth-callback`

/** Where the OAuth callback sends the browser back to: `APP_URL` (default http://localhost:5173), without a trailing slash. */
export const appUrl = (() => {
  const raw = Deno.env.get('APP_URL')?.trim() || 'http://localhost:5173'
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('APP_URL must be an http(s) URL')
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
})()
