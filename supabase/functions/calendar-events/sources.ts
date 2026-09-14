/**
 * Where a connection's events come from, per provider, behind one small interface so `collectDayEvents` can be
 * tested with fakes and with the real provider modules over an injected `fetch`.
 */
import type { AccessToken, FetchLike } from '../_shared/calendarProvider.ts'
import type { DayWindow, SourceEvent } from '../_shared/events.ts'
import { listGoogleEventsForDay, refreshGoogleAccessToken } from '../_shared/google.ts'
import type { IcsParser } from '../_shared/ics.ts'
import { listMicrosoftEventsForDay, refreshMicrosoftAccessToken } from '../_shared/microsoft.ts'

/** Per provider request (token refresh, one events page), on top of the overall deadline. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 10_000

export interface IcsSource {
  /** Throws IcsFetchError (fetch) or IcsParseError (not a calendar). */
  dayEvents(url: string, window: DayWindow, timeZone: string, signal: AbortSignal): Promise<{ events: SourceEvent[]; partial: boolean }>
}

export interface OAuthSource {
  /** Throws CalendarProviderError. `refreshToken` in the result is non-null when the provider rotated it. */
  refresh(refreshToken: string, now: Date, signal: AbortSignal): Promise<AccessToken>
  /** Throws CalendarProviderError; `calendar_gone` for a calendar that no longer exists. */
  dayEvents(accessToken: string, calendarId: string, window: DayWindow, timeZone: string, signal: AbortSignal): Promise<SourceEvent[]>
}

export interface CalendarSources {
  ics: IcsSource
  /** Null when the provider's client id and secret are not configured. */
  google: OAuthSource | null
  microsoft: OAuthSource | null
}

export function withSignal(fetch: FetchLike, signal: AbortSignal, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS): FetchLike {
  return (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })
}

export function createIcsSource(
  fetchIcs: (url: URL, signal: AbortSignal) => Promise<string>,
  parser: Pick<IcsParser, 'parseIcsForDay'>,
): IcsSource {
  return {
    async dayEvents(url, window, timeZone, signal) {
      const text = await fetchIcs(new URL(url), signal)
      return parser.parseIcsForDay(text, window.dayStartUtc, window.dayEndUtc, timeZone)
    },
  }
}

export function createOAuthSource(
  provider: 'google' | 'microsoft',
  fetch: FetchLike,
  client: { clientId: string; clientSecret: string } | null,
): OAuthSource | null {
  if (!client) return null
  const refresh = provider === 'google' ? refreshGoogleAccessToken : refreshMicrosoftAccessToken
  const list = provider === 'google' ? listGoogleEventsForDay : listMicrosoftEventsForDay
  return {
    refresh: (refreshToken, now, signal) => refresh(withSignal(fetch, signal), { ...client, refreshToken }, now),
    dayEvents: (accessToken, calendarId, window, timeZone, signal) => list(withSignal(fetch, signal), accessToken, calendarId, window, timeZone),
  }
}
