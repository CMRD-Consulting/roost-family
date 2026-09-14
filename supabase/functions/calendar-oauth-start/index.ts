/**
 * `calendar-oauth-start` Edge Function (spec §5.5, §6.3): a full sign-in adult begins connecting a Google or Microsoft
 * calendar account. See handler.ts for the contract. Credential-gated: without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
 * or `MS_CLIENT_ID`/`MS_CLIENT_SECRET` it answers `{ error: 'not_configured' }`.
 */
import { callerAuth, oauthClient, oauthRedirectUri, svc } from '../_shared/calendarDeno.ts'
import { oauthProviderApi } from '../_shared/oauthProviders.ts'
import { createOAuthStartHandler } from './handler.ts'

const handler = createOAuthStartHandler({
  requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
  clients: { google: oauthClient('google'), microsoft: oauthClient('microsoft') },
  api: (provider) => oauthProviderApi(provider, fetch),
  redirectUri: oauthRedirectUri,
  createState: async ({ stateHash, codeVerifier, householdId, membershipId, provider, redirectTo }) => {
    await svc<string>('svc_create_calendar_oauth_state', {
      p_state_hash: stateHash,
      p_code_verifier: codeVerifier,
      p_household_id: householdId,
      p_membership_id: membershipId,
      p_provider: provider,
      p_redirect_to: redirectTo,
    })
  },
})

Deno.serve(handler)
