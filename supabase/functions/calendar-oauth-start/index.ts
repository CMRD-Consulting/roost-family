/**
 * `calendar-oauth-start` Edge Function (spec §5.5, §6.3): a full sign-in adult begins connecting a Google or Microsoft
 * calendar account. See handler.ts for the contract. Credential-gated: without the provider's client id and secret,
 * APP_URL (outside a local stack) or CALENDAR_FINGERPRINT_KEY it answers `{ error: 'not_configured' }`.
 */
import { appUrl, callerAuth, fingerprint, oauthClient, oauthRedirectUri, svc } from '../_shared/calendarDeno.ts'
import { oauthProviderApi } from '../_shared/oauthProviders.ts'
import { createOAuthStartHandler } from './handler.ts'

const handler = createOAuthStartHandler({
  requireFullSignInAdult: (req, householdId) => callerAuth.requireFullSignInAdult(req, householdId),
  clients: { google: oauthClient('google'), microsoft: oauthClient('microsoft') },
  api: (provider) => oauthProviderApi(provider, fetch),
  redirectUri: oauthRedirectUri,
  ready: appUrl !== null && fingerprint !== null,
  createState: async ({ stateHash, codeVerifier, householdId, membershipId, provider }) => {
    await svc<string>('svc_create_calendar_oauth_state', {
      p_state_hash: stateHash,
      p_code_verifier: codeVerifier,
      p_household_id: householdId,
      p_membership_id: membershipId,
      p_provider: provider,
      p_redirect_to: 'manage',
    })
  },
})

Deno.serve(handler)
