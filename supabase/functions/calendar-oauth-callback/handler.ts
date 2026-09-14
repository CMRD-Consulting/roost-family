/**
 * HTTP handling for `calendar-oauth-callback`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * GET ?code&state (or ?error&state) from Google / Microsoft. The browser arrives without a Supabase JWT (the gateway's
 * JWT check is off for this function); the single-use `state` from calendar-oauth-start identifies the attempt.
 *
 * Nothing is connected here. Whoever completes consent in this browser may not be the adult who started it (a consent
 * link can be forwarded), so the callback only parks the result as a pending attempt: the code is exchanged, the
 * account's calendars are listed (validating the tokens), and the refresh token goes into Vault with the calendar list
 * in `calendar_oauth_attempts` for 15 minutes. The signed-in adult then finishes it with `calendar-oauth-finish`,
 * which binds it to their own membership.
 *
 * Always answers 302 to `${APP_URL}/manage`:
 *   ?calendar=pending&attempt=<token>   the token (32 random bytes, base64url) goes to calendar-oauth-finish; only its
 *                                       SHA-256 is stored
 *   ?calendar=error&reason=<reason>     invalid_state (none, unknown or used), expired (older than 10 minutes),
 *                                       access_denied, provider_error (any other provider error, no code, or no
 *                                       account id), not_configured, exchange_failed, no_refresh_token, list_failed,
 *                                       forbidden (the member may no longer connect calendars), internal
 * Without APP_URL (outside a local stack) it answers 503 { error: 'not_configured' } instead. Tokens and codes never
 * appear in redirects or logs.
 */
import type { CalendarProviderError } from '../_shared/calendarProvider.ts'
import type { OAuthClient, OAuthProvider, OAuthProviderApi } from '../_shared/oauthProviders.ts'
import { randomUrlToken, sha256Hex } from '../_shared/pkce.ts'

export interface ConsumedState {
  householdId: string
  membershipId: string
  provider: OAuthProvider
  codeVerifier: string
  expired: boolean
}

export interface PendingAttempt {
  attemptHash: string
  householdId: string
  membershipId: string
  provider: OAuthProvider
  /** The refresh token, stored in Vault. */
  secret: string
  accountLabel: string | null
  fingerprint: string
  calendars: Array<{ id: string; name: string }>
}

export interface OAuthCallbackDeps {
  /** Deletes and returns the attempt with this state hash; null when there is none. */
  consumeState(stateHash: string): Promise<ConsumedState | null>
  clients: Record<OAuthProvider, OAuthClient | null>
  api(provider: OAuthProvider): OAuthProviderApi
  redirectUri: string
  /** The app's origin (and base path) without a trailing slash; null when not configured. */
  appUrl: string | null
  /** HMAC-SHA256 hex under the server's fingerprint key; null when no key is configured. */
  fingerprint: ((value: string) => Promise<string>) | null
  /** Throws an error with `code: '42501'` when the membership may no longer connect calendars. */
  createAttempt(attempt: PendingAttempt): Promise<void>
  now(): Date
}

const STATE_MAX = 512
const LABEL_MAX = 200

function kind(e: unknown): string {
  const status = (e as CalendarProviderError | null)?.status
  return `${e instanceof Error ? e.name : 'error'}${typeof status === 'string' ? `:${status}` : ''}`
}

export function createOAuthCallbackHandler(deps: OAuthCallbackDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
    const appUrl = deps.appUrl
    if (!appUrl) {
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }
    const back = (query: Record<string, string>) =>
      new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/manage?${new URLSearchParams(query)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    const fail = (reason: string) => back({ calendar: 'error', reason })
    const params = new URL(req.url).searchParams

    try {
      const state = params.get('state')
      if (!state || state.length > STATE_MAX) return fail('invalid_state')
      const attempt = await deps.consumeState(await sha256Hex(state))
      if (!attempt) return fail('invalid_state')
      if (attempt.expired) return fail('expired')

      const providerError = params.get('error')
      if (providerError) return fail(providerError === 'access_denied' ? 'access_denied' : 'provider_error')
      const code = params.get('code')
      if (!code) return fail('provider_error')

      const client = deps.clients[attempt.provider]
      if (!client || !deps.fingerprint) return fail('not_configured')
      const api = deps.api(attempt.provider)

      let exchanged
      try {
        exchanged = await api.exchangeCode(
          { clientId: client.clientId, clientSecret: client.clientSecret, code, codeVerifier: attempt.codeVerifier, redirectUri: deps.redirectUri },
          deps.now(),
        )
      } catch (e) {
        console.error('calendar-oauth-callback: code exchange failed', attempt.provider, kind(e))
        return fail('exchange_failed')
      }
      const refreshToken = exchanged.token.refreshToken
      if (!refreshToken) return fail('no_refresh_token')
      if (!exchanged.subject) return fail('provider_error')

      let calendars
      try {
        calendars = await api.listCalendars(exchanged.token.accessToken)
      } catch (e) {
        console.error('calendar-oauth-callback: listing calendars failed', attempt.provider, kind(e))
        return fail('list_failed')
      }

      const token = randomUrlToken()
      const email = exchanged.email && !exchanged.email.includes('://') ? exchanged.email.slice(0, LABEL_MAX) : null
      try {
        await deps.createAttempt({
          attemptHash: await sha256Hex(token),
          householdId: attempt.householdId,
          membershipId: attempt.membershipId,
          provider: attempt.provider,
          secret: refreshToken,
          accountLabel: email,
          fingerprint: await deps.fingerprint(`${attempt.provider}:${exchanged.subject}`),
          // Primary calendar first, so it is the first one offered in Settings.
          calendars: [...calendars]
            .sort((a, b) => Number(b.primary) - Number(a.primary))
            .map((c) => ({ id: c.externalCalendarId, name: c.name })),
        })
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === '42501') return fail('forbidden')
        throw e
      }
      return back({ calendar: 'pending', attempt: token })
    } catch (e) {
      console.error('calendar-oauth-callback: failed', kind(e), (e as { code?: unknown } | null)?.code ?? '')
      return fail('internal')
    }
  }
}
