/**
 * The Google and Microsoft account-connection calls behind one interface, over an injected `fetch`, for the calendar
 * OAuth Edge Functions (and their tests, which pass a fake `fetch` to the real provider modules).
 *
 * `CALENDAR_PROVIDERS` below is the allowlist every entry point reads: Microsoft's wiring stays here, dormant.
 */
import type { AuthUrlInput, CodeExchangeInput, CodeExchangeResult, FetchLike, ProviderCalendar } from './calendarProvider.ts'
import { buildGoogleAuthUrl, exchangeGoogleCode, googleCanWrite, listGoogleCalendars } from './google.ts'
import { buildMicrosoftAuthUrl, exchangeMicrosoftCode, listMicrosoftCalendars, microsoftCanWrite } from './microsoft.ts'

/** Every provider Roost has connection code for, whether or not this build offers it. */
export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

/**
 * The providers this build actually offers — the one switch that decides (spec §5.5). Microsoft is written and
 * still tested, but switched off: `calendar-oauth-start` refuses it before a state exists, `calendar-oauth-callback`
 * refuses a stored attempt that names it, `calendar-oauth-finish` refuses to connect one, and
 * `calendar-create-event` refuses to write to one. Adding `'microsoft'` back here turns all four on again; nothing
 * else needs changing.
 *
 * `calendar-events` deliberately does not consult this: a `calendar_connections` row left over from a Microsoft
 * connection keeps being read, so a household that had one still sees its events rather than a broken calendar.
 */
export const CALENDAR_PROVIDERS: readonly OAuthProvider[] = ['google']

/** Whether `value` names a provider Roost has code for (`'ics'` is not one: a link never connects by OAuth). */
export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/** Whether `value` names a provider this build offers (`CALENDAR_PROVIDERS`). */
export function calendarProviderEnabled(value: unknown): value is OAuthProvider {
  return typeof value === 'string' && (CALENDAR_PROVIDERS as readonly string[]).includes(value)
}

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface OAuthProviderApi {
  buildAuthUrl(input: AuthUrlInput): string
  exchangeCode(input: CodeExchangeInput, now: Date): Promise<CodeExchangeResult>
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>
  /**
   * Whether the scopes the account granted allow adding an event. Accounts connected before Roost asked for write
   * access keep their old grant until they connect again, so this is recorded per connection (`can_write`).
   */
  canWrite(grantedScope: string | null): boolean
}

/** Default connection labels when the account's email is not available. */
export const DEFAULT_OAUTH_LABELS: Record<OAuthProvider, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook Calendar',
}

export const OAUTH_CALLBACK_PATH = '/functions/v1/calendar-oauth-callback'

export function oauthProviderApi(provider: OAuthProvider, fetch: FetchLike): OAuthProviderApi {
  if (provider === 'google') {
    return {
      buildAuthUrl: buildGoogleAuthUrl,
      exchangeCode: (input, now) => exchangeGoogleCode(fetch, input, now),
      listCalendars: (accessToken) => listGoogleCalendars(fetch, accessToken),
      canWrite: googleCanWrite,
    }
  }
  return {
    buildAuthUrl: buildMicrosoftAuthUrl,
    exchangeCode: (input, now) => exchangeMicrosoftCode(fetch, input, now),
    listCalendars: (accessToken) => listMicrosoftCalendars(fetch, accessToken),
    canWrite: microsoftCanWrite,
  }
}
