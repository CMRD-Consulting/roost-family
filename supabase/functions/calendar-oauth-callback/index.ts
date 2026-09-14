/**
 * `calendar-oauth-callback` Edge Function (spec §5.5): Google and Microsoft send the browser here after consent. The
 * gateway's JWT check is off (config.toml): the single-use state from calendar-oauth-start authenticates the attempt.
 * See handler.ts for the redirects it answers with.
 */
import type { FetchLike } from '../_shared/calendarProvider.ts'
import { appUrl, oauthClient, oauthRedirectUri, svc } from '../_shared/calendarDeno.ts'
import { oauthProviderApi } from '../_shared/oauthProviders.ts'
import { createOAuthCallbackHandler, type ConsumedState } from './handler.ts'

const PROVIDER_TIMEOUT_MS = 10_000
const timedFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })

interface StateRow {
  household_id: string
  membership_id: string
  provider: 'google' | 'microsoft'
  code_verifier: string
  redirect_to: 'settings' | 'manage'
  expired: boolean
}

const handler = createOAuthCallbackHandler({
  consumeState: async (stateHash): Promise<ConsumedState | null> => {
    const rows = await svc<StateRow[] | null>('svc_consume_calendar_oauth_state', { p_state_hash: stateHash })
    const row = rows?.[0]
    return row
      ? {
          householdId: row.household_id,
          membershipId: row.membership_id,
          provider: row.provider,
          codeVerifier: row.code_verifier,
          redirectTo: row.redirect_to,
          expired: row.expired,
        }
      : null
  },
  clients: { google: oauthClient('google'), microsoft: oauthClient('microsoft') },
  api: (provider) => oauthProviderApi(provider, timedFetch),
  redirectUri: oauthRedirectUri,
  appUrl,
  createConnection: ({ householdId, membershipId, provider, label, secret }) =>
    svc<string>('svc_create_calendar_connection', {
      p_household_id: householdId,
      p_membership_id: membershipId,
      p_provider: provider,
      p_label: label,
      p_secret: secret,
    }),
  addSelection: ({ connectionId, externalCalendarId, name }) =>
    svc<string>('svc_add_calendar_selection', {
      p_connection_id: connectionId,
      p_external_calendar_id: externalCalendarId,
      p_name: name,
      p_visible: false,
      p_assigned_membership_id: null,
      p_assigned_child_id: null,
    }),
  now: () => new Date(),
})

Deno.serve(handler)
