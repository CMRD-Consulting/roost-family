/**
 * Deno-only wiring shared by the calendar Edge Functions: Supabase clients, the caller auth helpers, DNS resolution
 * for the ICS host checks, and the environment (read once per isolate through runtimeConfig.ts, which guards the
 * local-only settings). Everything testable lives in the plain TypeScript modules next to this one.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createCallerAuth, type RpcClient } from './auth.ts'
import { fetchIcsFiltered } from './icsFetch.ts'
import type { IcsPrefilterOptions, IcsPrefilterResult } from './icsPrefilter.ts'
import { hmacSha256Hex } from './pkce.ts'
import { readCalendarRuntimeConfig } from './runtimeConfig.ts'

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

const config = readCalendarRuntimeConfig((name) => Deno.env.get(name), (message) => console.warn(message))

/**
 * `CALENDAR_ALLOW_PRIVATE_HOSTS=1` lets ICS subscriptions reach private hosts over http and other ports, for local
 * verification against a fixture on the host (supabase/functions/.env, git-ignored). Honoured only on a local stack.
 */
export const allowPrivateHosts = config.allowPrivateHosts

/** Where the OAuth flow returns the browser (`APP_URL`); null outside a local stack when unset. */
export const appUrl = config.appUrl

/** The OAuth redirect URI registered with Google and Microsoft. */
export const oauthRedirectUri = config.oauthRedirectUri

/** HMAC-SHA256 hex under `CALENDAR_FINGERPRINT_KEY`; null when the key is not configured. */
export const fingerprint: ((value: string) => Promise<string>) | null = config.fingerprintKey
  ? (value) => hmacSha256Hex(config.fingerprintKey!, value)
  : null

/** Keeps work alive after the response when the edge runtime supports it. */
export function waitUntil(work: Promise<unknown>): void {
  ;(globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(work)
}

/** IPv4 and IPv6 addresses of a host; [] when neither resolves. */
export async function resolveHost(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([Deno.resolveDns(hostname, 'A'), Deno.resolveDns(hostname, 'AAAA')])
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/** The reduced calendar and what reading it cost; `prefilter` says which day to keep, or to stop at the header. */
export function fetchIcs(url: URL, prefilter: IcsPrefilterOptions, signal?: AbortSignal): Promise<IcsPrefilterResult> {
  return fetchIcsFiltered(url, { fetch, resolveHost, allowPrivateHosts, signal }, prefilter)
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

/** The row returned by svc_create_calendar_connection_with_selections. */
export interface ConnectRow {
  connection_id: string
  already_connected: boolean
  label: string
  calendar_count: number
  selection_ids: Array<string | null>
}
