/**
 * Environment-derived settings for the calendar Edge Functions, with production guards. Plain TypeScript over an
 * injected env reader so Vitest can exercise it; calendarDeno.ts passes `Deno.env.get`.
 *
 * "Local" means SUPABASE_URL's host is localhost, 127.0.0.1, kong (the local stack's gateway as seen from the edge
 * runtime) or host.docker.internal. Anywhere else:
 * - `CALENDAR_ALLOW_PRIVATE_HOSTS` is ignored (with one warning), so ICS links can never reach private networks.
 * - `APP_URL` has no default: without it the OAuth functions answer `not_configured`.
 * - `CALENDAR_FINGERPRINT_KEY` (at least 32 characters) is required: without it connecting answers `not_configured`.
 */

export type EnvReader = (name: string) => string | undefined

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'kong', 'host.docker.internal'])
const DEV_APP_URL = 'http://localhost:5173'
const FINGERPRINT_KEY_MIN = 32
/** Used only on a local stack when CALENDAR_FINGERPRINT_KEY is unset. Never a production value. */
export const LOCAL_FINGERPRINT_KEY = 'roost-local-development-calendar-fingerprint-key'

export interface CalendarRuntimeConfig {
  isLocal: boolean
  allowPrivateHosts: boolean
  /** Origin and base path without a trailing slash; null when not configured. */
  appUrl: string | null
  /** HMAC key for connection fingerprints; null when not configured. */
  fingerprintKey: string | null
  oauthRedirectUri: string
}

export function isLocalSupabaseUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function httpUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function readCalendarRuntimeConfig(env: EnvReader, warn: (message: string) => void): CalendarRuntimeConfig {
  const supabaseUrl = env('SUPABASE_URL')?.trim() ?? ''
  const isLocal = isLocalSupabaseUrl(supabaseUrl)

  const wantsPrivateHosts = env('CALENDAR_ALLOW_PRIVATE_HOSTS') === '1'
  if (wantsPrivateHosts && !isLocal) warn('CALENDAR_ALLOW_PRIVATE_HOSTS is ignored: SUPABASE_URL is not a local stack')

  const configuredAppUrl = httpUrl(env('APP_URL'))
  const key = env('CALENDAR_FINGERPRINT_KEY')?.trim()
  return {
    isLocal,
    allowPrivateHosts: wantsPrivateHosts && isLocal,
    appUrl: configuredAppUrl ?? (isLocal && !env('APP_URL')?.trim() ? DEV_APP_URL : null),
    fingerprintKey: key && key.length >= FINGERPRINT_KEY_MIN ? key : isLocal && !key ? LOCAL_FINGERPRINT_KEY : null,
    oauthRedirectUri:
      env('CALENDAR_OAUTH_REDIRECT_URI')?.trim() || `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/calendar-oauth-callback`,
  }
}
