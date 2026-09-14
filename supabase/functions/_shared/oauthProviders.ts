/**
 * The Google and Microsoft account-connection calls behind one interface, over an injected `fetch`, for the calendar
 * OAuth Edge Functions (and their tests, which pass a fake `fetch` to the real provider modules).
 */
import type { AuthUrlInput, CodeExchangeInput, CodeExchangeResult, FetchLike, ProviderCalendar } from './calendarProvider.ts'
import { buildGoogleAuthUrl, exchangeGoogleCode, listGoogleCalendars } from './google.ts'
import { buildMicrosoftAuthUrl, exchangeMicrosoftCode, listMicrosoftCalendars } from './microsoft.ts'

export type OAuthProvider = 'google' | 'microsoft'

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface OAuthProviderApi {
  buildAuthUrl(input: AuthUrlInput): string
  exchangeCode(input: CodeExchangeInput, now: Date): Promise<CodeExchangeResult>
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>
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
    }
  }
  return {
    buildAuthUrl: buildMicrosoftAuthUrl,
    exchangeCode: (input, now) => exchangeMicrosoftCode(fetch, input, now),
    listCalendars: (accessToken) => listMicrosoftCalendars(fetch, accessToken),
  }
}
