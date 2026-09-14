/**
 * HTTP handling for `calendar-oauth-start`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId, provider: 'google' | 'microsoft', returnTo?: 'settings' | 'manage' } with a full sign-in adult's JWT.
 *   200 { url }                       open this URL in the browser (the provider's consent page)
 *   200 { error: 'not_configured' }   the provider's client id/secret are not set on the server. Deliberately a 200:
 *                                     it describes what the server offers rather than a failure, so the UI can read
 *                                     it from `functions.invoke`'s `data` and disable that provider's button.
 *   400 { error: 'invalid_request' }  401/403 { error: 'forbidden' }  500 { error: 'internal' }
 *
 * A random `state` and PKCE verifier are generated per attempt; only the state's SHA-256 is stored (with the verifier,
 * the caller's own membership, the provider and the return page) and it expires after 10 minutes. The browser comes
 * back to `calendar-oauth-callback`.
 */
import { AuthError } from '../_shared/auth.ts'
import { UUID_RE, jsonResponse, preflight, readJsonObject } from '../_shared/http.ts'
import type { OAuthClient, OAuthProvider, OAuthProviderApi } from '../_shared/oauthProviders.ts'
import { randomUrlToken, s256Challenge, sha256Hex } from '../_shared/pkce.ts'

const METHODS = 'POST'

export interface OAuthStartDeps {
  requireFullSignInAdult(req: Request, householdId: string): Promise<string>
  clients: Record<OAuthProvider, OAuthClient | null>
  api(provider: OAuthProvider): OAuthProviderApi
  /** The callback URL registered with the providers. */
  redirectUri: string
  createState(input: {
    stateHash: string
    codeVerifier: string
    householdId: string
    membershipId: string
    provider: OAuthProvider
    redirectTo: 'settings' | 'manage'
  }): Promise<void>
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

export function createOAuthStartHandler(deps: OAuthStartDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const body = await readJsonObject(req)
    const householdId = body?.householdId
    const provider = body?.provider
    const returnTo = body?.returnTo ?? 'settings'
    if (
      typeof householdId !== 'string' ||
      !UUID_RE.test(householdId) ||
      (provider !== 'google' && provider !== 'microsoft') ||
      (returnTo !== 'settings' && returnTo !== 'manage')
    ) {
      return json(400, { error: 'invalid_request' })
    }

    try {
      const membershipId = await deps.requireFullSignInAdult(req, householdId)
      const client = deps.clients[provider]
      if (!client) return json(200, { error: 'not_configured' })

      const state = randomUrlToken()
      const codeVerifier = randomUrlToken()
      await deps.createState({ stateHash: await sha256Hex(state), codeVerifier, householdId, membershipId, provider, redirectTo: returnTo })
      const url = deps.api(provider).buildAuthUrl({
        clientId: client.clientId,
        redirectUri: deps.redirectUri,
        state,
        codeChallenge: await s256Challenge(codeVerifier),
      })
      return json(200, { url })
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: 'forbidden' })
      if ((e as { code?: unknown } | null)?.code === '42501') return json(403, { error: 'forbidden' })
      console.error('calendar-oauth-start: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
