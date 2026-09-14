/**
 * HTTP handling for `calendar-oauth-callback`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * GET ?code&state (or ?error&state) from Google / Microsoft. The browser arrives without a Supabase JWT (the gateway's
 * JWT check is off for this function); the single-use `state` from calendar-oauth-start authenticates the attempt.
 *
 * Always answers 302 to the app: `${APP_URL}/settings?calendar=connected` (or `/manage`, per the attempt's returnTo),
 * or `?calendar=error&reason=<reason>` with reason one of:
 *   invalid_state     no state, or unknown / already used
 *   expired           the attempt is older than 10 minutes
 *   access_denied     the adult declined consent
 *   provider_error    any other provider error, or no code
 *   not_configured    the provider's client id/secret are not set
 *   exchange_failed   the code could not be exchanged
 *   no_refresh_token  the provider issued no refresh token (nothing to keep the connection working)
 *   list_failed       the account's calendars could not be listed
 *   forbidden         the member may no longer connect calendars
 *   internal          anything else
 * Unknown or used states return to Settings. Tokens and codes never appear in redirects or logs.
 *
 * On success the connection is created for the attempt's membership with the refresh token as its Vault secret,
 * labelled with the account's email (or "Google Calendar" / "Outlook Calendar"), and every calendar of the account is
 * recorded hidden and unassigned for the adult to assign in Settings.
 */
import type { CalendarProviderError } from '../_shared/calendarProvider.ts'
import { DEFAULT_OAUTH_LABELS, type OAuthClient, type OAuthProvider, type OAuthProviderApi } from '../_shared/oauthProviders.ts'
import { sha256Hex } from '../_shared/pkce.ts'

export type ReturnPage = 'settings' | 'manage'

export interface ConsumedState {
  householdId: string
  membershipId: string
  provider: OAuthProvider
  codeVerifier: string
  redirectTo: ReturnPage
  expired: boolean
}

export interface OAuthCallbackDeps {
  /** Deletes and returns the attempt with this state hash; null when there is none. */
  consumeState(stateHash: string): Promise<ConsumedState | null>
  clients: Record<OAuthProvider, OAuthClient | null>
  api(provider: OAuthProvider): OAuthProviderApi
  redirectUri: string
  /** The app's origin (and base path), without a trailing slash. */
  appUrl: string
  /** Throws an error with `code: '42501'` when the membership may no longer connect calendars. */
  createConnection(input: { householdId: string; membershipId: string; provider: OAuthProvider; label: string; secret: string }): Promise<string>
  addSelection(input: { connectionId: string; externalCalendarId: string; name: string }): Promise<string>
  now(): Date
}

const STATE_MAX = 512
const LABEL_MAX = 200

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

function kind(e: unknown): string {
  const status = (e as CalendarProviderError | null)?.status
  return `${e instanceof Error ? e.name : 'error'}${typeof status === 'string' ? `:${status}` : ''}`
}

export function createOAuthCallbackHandler(deps: OAuthCallbackDeps): (req: Request) => Promise<Response> {
  const back = (page: ReturnPage, query: Record<string, string>) => redirect(`${deps.appUrl}/${page}?${new URLSearchParams(query)}`)
  const fail = (reason: string, page: ReturnPage = 'settings') => back(page, { calendar: 'error', reason })

  return async (req) => {
    if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
    const params = new URL(req.url).searchParams
    let page: ReturnPage = 'settings'

    try {
      const state = params.get('state')
      if (!state || state.length > STATE_MAX) return fail('invalid_state')
      const attempt = await deps.consumeState(await sha256Hex(state))
      if (!attempt) return fail('invalid_state')
      page = attempt.redirectTo
      if (attempt.expired) return fail('expired', page)

      const providerError = params.get('error')
      if (providerError) return fail(providerError === 'access_denied' ? 'access_denied' : 'provider_error', page)
      const code = params.get('code')
      if (!code) return fail('provider_error', page)

      const client = deps.clients[attempt.provider]
      if (!client) return fail('not_configured', page)
      const api = deps.api(attempt.provider)

      let exchanged
      try {
        exchanged = await api.exchangeCode(
          { clientId: client.clientId, clientSecret: client.clientSecret, code, codeVerifier: attempt.codeVerifier, redirectUri: deps.redirectUri },
          deps.now(),
        )
      } catch (e) {
        console.error('calendar-oauth-callback: code exchange failed', attempt.provider, kind(e))
        return fail('exchange_failed', page)
      }
      const refreshToken = exchanged.token.refreshToken
      if (!refreshToken) return fail('no_refresh_token', page)

      let calendars
      try {
        calendars = await api.listCalendars(exchanged.token.accessToken)
      } catch (e) {
        console.error('calendar-oauth-callback: listing calendars failed', attempt.provider, kind(e))
        return fail('list_failed', page)
      }

      const email = exchanged.email && !exchanged.email.includes('://') ? exchanged.email.slice(0, LABEL_MAX) : null
      let connectionId: string
      try {
        connectionId = await deps.createConnection({
          householdId: attempt.householdId,
          membershipId: attempt.membershipId,
          provider: attempt.provider,
          label: email ?? DEFAULT_OAUTH_LABELS[attempt.provider],
          secret: refreshToken,
        })
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === '42501') return fail('forbidden', page)
        throw e
      }

      // Primary calendar first, so it is the first one offered in Settings.
      const ordered = [...calendars].sort((a, b) => Number(b.primary) - Number(a.primary))
      let failed = 0
      for (const calendar of ordered) {
        try {
          await deps.addSelection({ connectionId, externalCalendarId: calendar.externalCalendarId, name: calendar.name })
        } catch (e) {
          failed++
          console.error('calendar-oauth-callback: recording a calendar failed', kind(e))
        }
      }
      if (failed) console.error(`calendar-oauth-callback: ${failed} of ${ordered.length} calendars not recorded for connection ${connectionId}`)
      return back(page, { calendar: 'connected' })
    } catch (e) {
      console.error('calendar-oauth-callback: failed', kind(e), (e as { code?: unknown } | null)?.code ?? '')
      return fail('internal', page)
    }
  }
}
