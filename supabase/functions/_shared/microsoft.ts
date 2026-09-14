/**
 * Microsoft 365 / Outlook calendar client via Microsoft Graph (spec §5.5): token refresh, calendar list, and the
 * day's `calendarView` mapped to `SourceEvent`.
 *
 * Mapping and error classification are pure functions over status + JSON and are unit-tested with recorded-shape
 * fixtures. The network functions take an injected `fetch`; they cannot be exercised against Microsoft locally
 * without OAuth credentials (`MS_CLIENT_ID` / `MS_CLIENT_SECRET`).
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

export const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0'
export const MICROSOFT_SCOPES = 'offline_access Calendars.Read'

const DAY_MS = 86_400_000

/**
 * Whether a failed Microsoft response means the owner must reconnect (`auth_expired`) or it may recover on its own
 * (`unreachable`).
 * - Token endpoint `invalid_grant` / `interaction_required` (expired or revoked refresh token, MFA or consent
 *   required): `auth_expired`.
 * - Graph 401, 403 (access denied) and 404 (calendar removed or unshared — reconnecting refreshes the list):
 *   `auth_expired`.
 * - `invalid_client` / `unauthorized_client` (our credentials are wrong), 429, 5xx, other 4xx, unparseable: `unreachable`.
 */
export function classifyMicrosoftError(status: number, body: unknown): ProviderFailure {
  if (isExpiredGrantError(body)) return 'auth_expired'
  const oauthCode = oauthErrorCode(body)
  if (oauthCode === 'invalid_client' || oauthCode === 'unauthorized_client') return 'unreachable'
  if (status === 401 || status === 403 || status === 404) return 'auth_expired'
  return 'unreachable'
}

/** Microsoft rotates refresh tokens: when `refreshToken` is non-null the stored secret must be replaced. */
export function parseMicrosoftTokenResponse(status: number, body: unknown, now: Date): AccessToken {
  return parseTokenResponse(status, body, now, classifyMicrosoftError)
}

export function mapMicrosoftCalendars(body: unknown): { calendars: ProviderCalendar[]; nextLink: string | null } {
  if (!isRecord(body)) return { calendars: [], nextLink: null }
  const items = Array.isArray(body.value) ? body.value : []
  const calendars: ProviderCalendar[] = []
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = stringOrNull(item.id)
    if (!id) continue
    calendars.push({ externalCalendarId: id, name: stringOrNull(item.name) ?? 'Calendar', primary: item.isDefaultCalendar === true })
  }
  return { calendars, nextLink: stringOrNull(body['@odata.nextLink']) }
}

/**
 * Maps a `calendarView` page (requested with `Prefer: outlook.timezone="UTC"`). Timed events read `start.dateTime`
 * in `start.timeZone` (UTC, or any IANA name; a non-IANA name is read as UTC since UTC was requested). All-day events
 * (`isAllDay`) take the date part and place it at midnight in the household zone. Cancelled events are dropped.
 */
export function mapMicrosoftEvents(body: unknown, timeZone: string): { events: SourceEvent[]; nextLink: string | null } {
  if (!isRecord(body)) return { events: [], nextLink: null }
  const items = Array.isArray(body.value) ? body.value : []
  const events: SourceEvent[] = []
  for (const item of items) {
    if (!isRecord(item) || item.isCancelled === true) continue
    const start = isRecord(item.start) ? item.start : {}
    const end = isRecord(item.end) ? item.end : {}
    const allDay = item.isAllDay === true
    let startMs: number
    let endMs: number
    if (allDay) {
      startMs = dateToUtcMs(start.dateTime, timeZone)
      endMs = dateToUtcMs(end.dateTime, timeZone)
      if (!(endMs > startMs)) endMs = startMs + DAY_MS
    } else {
      startMs = dateTimeToUtcMs(start.dateTime, start.timeZone)
      endMs = dateTimeToUtcMs(end.dateTime, end.timeZone ?? start.timeZone)
    }
    if (Number.isNaN(startMs)) continue
    if (!(endMs >= startMs)) endMs = startMs
    events.push({
      title: cleanTitle(item.subject),
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      allDay,
      location: cleanLocation(isRecord(item.location) ? item.location.displayName : null),
    })
  }
  return { events, nextLink: stringOrNull(body['@odata.nextLink']) }
}

// ---- Network (injected fetch) ----

export async function refreshMicrosoftAccessToken(fetch: FetchLike, credentials: OAuthClientCredentials, now: Date): Promise<AccessToken> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    scope: MICROSOFT_SCOPES,
  })
  let res: Response
  try {
    res = await fetch(MICROSOFT_TOKEN_URL, {
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
  return parseMicrosoftTokenResponse(res.status, body, now)
}

function graphHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', Prefer: 'outlook.timezone="UTC"' }
}

/** Follows `@odata.nextLink` only within Graph, so the bearer token is never sent elsewhere. */
function assertGraphLink(link: string): string {
  if (!link.startsWith(`${MICROSOFT_GRAPH_API}/`)) {
    throw new CalendarProviderError('unreachable', 'unexpected @odata.nextLink host')
  }
  return link
}

export async function listMicrosoftCalendars(fetch: FetchLike, accessToken: string): Promise<ProviderCalendar[]> {
  const calendars: ProviderCalendar[] = []
  let url: string | null = `${MICROSOFT_GRAPH_API}/me/calendars?${new URLSearchParams({ $select: 'id,name,isDefaultCalendar', $top: '100' })}`
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { body } = await requestJson(fetch, url, { headers: graphHeaders(accessToken) }, classifyMicrosoftError)
    const mapped = mapMicrosoftCalendars(body)
    calendars.push(...mapped.calendars)
    url = mapped.nextLink ? assertGraphLink(mapped.nextLink) : null
  }
  return calendars
}

/** Events overlapping the household day; `calendarView` expands recurring series into instances. */
export async function listMicrosoftEventsForDay(
  fetch: FetchLike,
  accessToken: string,
  calendarId: string,
  window: DayWindow,
  timeZone: string,
): Promise<SourceEvent[]> {
  const events: SourceEvent[] = []
  const params = new URLSearchParams({
    startDateTime: window.dayStartUtc.toISOString(),
    endDateTime: window.dayEndUtc.toISOString(),
    // Only what Roost shows: never bodies, attendees, organizers or links.
    $select: 'subject,start,end,isAllDay,isCancelled,location',
    $orderby: 'start/dateTime',
    $top: '250',
  })
  let url: string | null = `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { body } = await requestJson(fetch, url, { headers: graphHeaders(accessToken) }, classifyMicrosoftError)
    const mapped = mapMicrosoftEvents(body, timeZone)
    events.push(...mapped.events)
    url = mapped.nextLink ? assertGraphLink(mapped.nextLink) : null
  }
  return events
}
