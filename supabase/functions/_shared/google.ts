/**
 * Google Calendar client (spec §5.5): token refresh, calendar list, and the day's events mapped to `SourceEvent`.
 *
 * Mapping and error classification are pure functions over status + JSON and are unit-tested with recorded-shape
 * fixtures. The network functions take an injected `fetch`; they cannot be exercised against Google locally
 * without OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
 */
import {
  CalendarProviderError,
  MAX_PAGES,
  dateTimeToUtcMs,
  dateToUtcMs,
  isExpiredGrantError,
  isRecord,
  oauthErrorCode,
  parseTokenResponse,
  requestJson,
  stringOrNull,
  type AccessToken,
  type FetchLike,
  type OAuthClientCredentials,
  type ProviderCalendar,
  type ProviderFailure,
} from './calendarProvider.ts'
import { cleanLocation, cleanTitle, type DayWindow, type SourceEvent } from './events.ts'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

const DAY_MS = 86_400_000

/** Google API error reasons that are temporary, not a lost grant. */
const TRANSIENT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'])

function googleErrorReasons(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body.error) || !Array.isArray(body.error.errors)) return []
  return body.error.errors.map((e) => (isRecord(e) ? stringOrNull(e.reason) : null)).filter((r): r is string => r !== null)
}

/**
 * Whether a failed Google response means the owner must reconnect (`auth_expired`) or it may recover on its own
 * (`unreachable`).
 * - Token endpoint `invalid_grant` (revoked, expired, or a Testing-status app's 7-day token): `auth_expired`.
 * - 401 from the API, 403 other than rate limits (e.g. `insufficientPermissions`), and 404 (the calendar was
 *   removed or unshared — reconnecting refreshes the calendar list): `auth_expired`.
 * - `invalid_client` / `unauthorized_client` (our credentials are wrong; reconnecting cannot help), 429, 5xx,
 *   other 4xx and anything unparseable: `unreachable`.
 */
export function classifyGoogleError(status: number, body: unknown): ProviderFailure {
  if (isExpiredGrantError(body)) return 'auth_expired'
  const oauthCode = oauthErrorCode(body)
  if (oauthCode === 'invalid_client' || oauthCode === 'unauthorized_client') return 'unreachable'
  if (status === 401 || status === 404) return 'auth_expired'
  if (status === 403) return googleErrorReasons(body).some((r) => TRANSIENT_REASONS.has(r)) ? 'unreachable' : 'auth_expired'
  return 'unreachable'
}

export function parseGoogleTokenResponse(status: number, body: unknown, now: Date): AccessToken {
  return parseTokenResponse(status, body, now, classifyGoogleError)
}

/** Maps a `calendarList.list` page. The user's own name for a calendar (`summaryOverride`) wins. */
export function mapGoogleCalendarList(body: unknown): { calendars: ProviderCalendar[]; nextPageToken: string | null } {
  if (!isRecord(body)) return { calendars: [], nextPageToken: null }
  const items = Array.isArray(body.items) ? body.items : []
  const calendars: ProviderCalendar[] = []
  for (const item of items) {
    if (!isRecord(item) || item.deleted === true) continue
    const id = stringOrNull(item.id)
    if (!id) continue
    calendars.push({
      externalCalendarId: id,
      name: stringOrNull(item.summaryOverride) ?? stringOrNull(item.summary) ?? id,
      primary: item.primary === true,
    })
  }
  return { calendars, nextPageToken: stringOrNull(body.nextPageToken) }
}

/**
 * Maps an `events.list` page (requested with `singleEvents=true`, so recurring events arrive as instances).
 * All-day events use `date` values (end exclusive) placed at midnight in the household zone; timed events use
 * `dateTime` with its offset. Cancelled instances and events without usable times are dropped.
 */
export function mapGoogleEvents(body: unknown, timeZone: string): { events: SourceEvent[]; nextPageToken: string | null } {
  if (!isRecord(body)) return { events: [], nextPageToken: null }
  const items = Array.isArray(body.items) ? body.items : []
  const events: SourceEvent[] = []
  for (const item of items) {
    if (!isRecord(item) || item.status === 'cancelled') continue
    const start = isRecord(item.start) ? item.start : {}
    const end = isRecord(item.end) ? item.end : {}
    const allDay = typeof start.date === 'string'
    let startMs: number
    let endMs: number
    if (allDay) {
      startMs = dateToUtcMs(start.date, timeZone)
      endMs = typeof end.date === 'string' ? dateToUtcMs(end.date, timeZone) : startMs + DAY_MS
    } else {
      startMs = dateTimeToUtcMs(start.dateTime, start.timeZone)
      endMs = dateTimeToUtcMs(end.dateTime, end.timeZone ?? start.timeZone)
    }
    if (Number.isNaN(startMs)) continue
    if (!(endMs >= startMs)) endMs = startMs
    events.push({
      title: cleanTitle(item.summary),
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      allDay,
      location: cleanLocation(item.location),
    })
  }
  return { events, nextPageToken: stringOrNull(body.nextPageToken) }
}

// ---- Network (injected fetch) ----

export async function refreshGoogleAccessToken(fetch: FetchLike, credentials: OAuthClientCredentials, now: Date): Promise<AccessToken> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  })
  let res: Response
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
  } catch (e) {
    throw new CalendarProviderError('unreachable', `token request failed: ${e instanceof Error ? e.name : 'error'}`)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return parseGoogleTokenResponse(res.status, body, now)
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
}

export async function listGoogleCalendars(fetch: FetchLike, accessToken: string): Promise<ProviderCalendar[]> {
  const calendars: ProviderCalendar[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxResults: '250', fields: 'items(id,summary,summaryOverride,primary,deleted),nextPageToken' })
    if (pageToken) params.set('pageToken', pageToken)
    const { body } = await requestJson(
      fetch,
      `${GOOGLE_CALENDAR_API}/users/me/calendarList?${params}`,
      { headers: authHeaders(accessToken) },
      classifyGoogleError,
    )
    const mapped = mapGoogleCalendarList(body)
    calendars.push(...mapped.calendars)
    pageToken = mapped.nextPageToken
    if (!pageToken) break
  }
  return calendars
}

/** Events overlapping the household day (Google's `timeMin` filters by end, `timeMax` by start). */
export async function listGoogleEventsForDay(
  fetch: FetchLike,
  accessToken: string,
  calendarId: string,
  window: DayWindow,
  timeZone: string,
): Promise<SourceEvent[]> {
  const events: SourceEvent[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: window.dayStartUtc.toISOString(),
      timeMax: window.dayEndUtc.toISOString(),
      maxResults: '250',
      // Only what Roost shows: never descriptions, attendees, links or conference data.
      fields: 'items(status,summary,location,start,end),nextPageToken',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const { body } = await requestJson(
      fetch,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: authHeaders(accessToken) },
      classifyGoogleError,
    )
    const mapped = mapGoogleEvents(body, timeZone)
    events.push(...mapped.events)
    pageToken = mapped.nextPageToken
    if (!pageToken) break
  }
  return events
}
