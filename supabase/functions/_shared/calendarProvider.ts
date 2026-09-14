/**
 * Pieces shared by the Google and Microsoft calendar clients (spec §5.5, §13): the calendar and token shapes, the
 * per-connection failure kinds, and a JSON request helper over an injected `fetch`.
 *
 * Plain TypeScript only, so Vitest exercises the mapping with recorded-shape fixtures and a fake `fetch`; the Edge
 * Functions pass the real `fetch` (with their own timeout signal) at the call site.
 */
import { isValidTimeZone, zonedWallTimeToUtc } from './events.ts'

/** A connection's health as shown to the household. `auth_expired` asks the owner to reconnect. */
export type ConnectionStatus = 'ok' | 'auth_expired' | 'unreachable'
/**
 * Why a provider call failed. `calendar_gone` (the calendar was deleted or unshared) applies only to the selection
 * whose events were requested; the connection's other calendars are unaffected.
 */
export type ProviderFailure = Exclude<ConnectionStatus, 'ok'> | 'calendar_gone'
export type Classifier = (status: number, body: unknown) => ProviderFailure

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** A calendar the account can read, as offered when choosing which calendars to show. */
export interface ProviderCalendar {
  externalCalendarId: string
  name: string
  primary: boolean
}

export interface AccessToken {
  accessToken: string
  expiresAt: Date
  /** A new refresh token when the provider issued one (code exchange; Microsoft rotates on refresh). */
  refreshToken: string | null
}

export interface OAuthClientCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** Thrown by provider calls; `status` is what the connection should be marked as. Messages never contain tokens. */
export class CalendarProviderError extends Error {
  constructor(
    readonly status: ProviderFailure,
    message: string,
  ) {
    super(message)
    this.name = 'CalendarProviderError'
  }
}

/** Upper bound on followed result pages, so a misbehaving API cannot keep a request running. */
export const MAX_PAGES = 10

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** The response body as JSON when it parses, otherwise as text (error pages are often HTML). */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * For calls about the whole connection (token, calendar list), where "not found" cannot mean one calendar went
 * away: `calendar_gone` becomes `unreachable`.
 */
export function connectionLevel(classify: Classifier): Classifier {
  return (status, body) => {
    const failure = classify(status, body)
    return failure === 'calendar_gone' ? 'unreachable' : failure
  }
}

/** Performs a request and returns the parsed body, throwing `CalendarProviderError` on network or HTTP failure. */
export async function requestJson(
  fetch: FetchLike,
  url: string,
  init: RequestInit,
  classify: Classifier,
): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new CalendarProviderError('unreachable', `request failed: ${e instanceof Error ? e.name : 'error'}`)
  }
  let body: unknown
  try {
    body = await readBody(res)
  } catch {
    throw new CalendarProviderError('unreachable', `could not read response (HTTP ${res.status})`)
  }
  if (!res.ok) throw new CalendarProviderError(classify(res.status, body), `HTTP ${res.status}`)
  return { status: res.status, body }
}

/**
 * Reads an OAuth 2.0 token endpoint response (refresh or authorization-code grant). Failures throw with the
 * provider's classification; a 2xx without an access token is treated as `unreachable`.
 */
export function parseTokenResponse(status: number, body: unknown, now: Date, classify: Classifier): AccessToken {
  if (status < 200 || status >= 300) {
    throw new CalendarProviderError(connectionLevel(classify)(status, body), `token request failed (HTTP ${status})`)
  }
  const accessToken = isRecord(body) ? stringOrNull(body.access_token) : null
  if (!isRecord(body) || !accessToken) throw new CalendarProviderError('unreachable', 'token response has no access_token')
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600
  return {
    accessToken,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshToken: stringOrNull(body.refresh_token),
  }
}

/** The OAuth `error` code from a token endpoint body (`{ error: 'invalid_grant' }`), if any. */
export function oauthErrorCode(body: unknown): string | null {
  return isRecord(body) ? stringOrNull(body.error) : null
}

/** Token endpoint errors meaning the user's grant is gone and they must reconnect. */
const EXPIRED_GRANT_ERRORS = new Set(['invalid_grant', 'interaction_required', 'consent_required', 'login_required'])

export function isExpiredGrantError(body: unknown): boolean {
  const code = oauthErrorCode(body)
  return code !== null && EXPIRED_GRANT_ERRORS.has(code)
}

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/

/** `YYYY-MM-DD` (or the date part of a date-time) as midnight in `timeZone`, in UTC ms; NaN when unparseable. */
export function dateToUtcMs(value: unknown, timeZone: string): number {
  const m = typeof value === 'string' ? DATE_TIME_RE.exec(value) : null
  if (!m) return Number.NaN
  return zonedWallTimeToUtc({ year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: 0, minute: 0, second: 0 }, timeZone).getTime()
}

/**
 * A date-time as UTC ms. Values with `Z` or an offset are absolute; bare wall-clock values are read in `zone` when
 * it is an IANA name, otherwise as UTC (callers ask providers for UTC). NaN when unparseable.
 */
export function dateTimeToUtcMs(value: unknown, zone: unknown): number {
  if (typeof value !== 'string') return Number.NaN
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return Date.parse(value)
  const m = DATE_TIME_RE.exec(value)
  if (!m || m[4] === undefined) return Number.NaN
  const timeZone = typeof zone === 'string' && isValidTimeZone(zone) ? zone : 'UTC'
  return zonedWallTimeToUtc(
    { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4], minute: +m[5]!, second: m[6] ? +m[6] : 0 },
    timeZone,
  ).getTime()
}
