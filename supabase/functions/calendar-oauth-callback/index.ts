/**
 * `calendar-oauth-callback` Edge Function (spec §5.5): Google and Microsoft send the browser here after consent. The
 * gateway's JWT check is off (config.toml): the single-use state from calendar-oauth-start identifies the attempt,
 * and the result is only parked as a pending attempt for calendar-oauth-finish. See handler.ts.
 */
import type { FetchLike } from '../_shared/calendarProvider.ts'
import { appUrl, fingerprint, oauthClient, oauthRedirectUri, svc } from '../_shared/calendarDeno.ts'
import { oauthProviderApi } from '../_shared/oauthProviders.ts'
import { createOAuthCallbackHandler, type ConsumedState } from './handler.ts'

const PROVIDER_TIMEOUT_MS = 10_000
const timedFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })

interface StateRow {
  household_id: string
  membership_id: string
  provider: 'google' | 'microsoft'
  code_verifier: string
  expired: boolean
}

const handler = createOAuthCallbackHandler({
  consumeState: async (stateHash): Promise<ConsumedState | null> => {
    const rows = await svc<StateRow[] | null>('svc_consume_calendar_oauth_state', { p_state_hash: stateHash })
    const row = rows?.[0]
    return row
      ? { householdId: row.household_id, membershipId: row.membership_id, provider: row.provider, codeVerifier: row.code_verifier, expired: row.expired }
      : null
  },
  clients: { google: oauthClient('google'), microsoft: oauthClient('microsoft') },
  api: (provider) => oauthProviderApi(provider, timedFetch),
  redirectUri: oauthRedirectUri,
  appUrl,
  fingerprint,
  createAttempt: async (attempt) => {
    await svc<string>('svc_create_calendar_oauth_attempt', {
      p_attempt_hash: attempt.attemptHash,
      p_household_id: attempt.householdId,
      p_membership_id: attempt.membershipId,
      p_provider: attempt.provider,
      p_secret: attempt.secret,
      p_account_label: attempt.accountLabel,
      p_fingerprint: attempt.fingerprint,
      p_calendars: attempt.calendars,
    })
  },
  now: () => new Date(),
})

Deno.serve(handler)
