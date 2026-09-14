/**
 * HTTP handling for `calendar-oauth-start`, kept free of Deno and Supabase so Vitest can exercise it.
 *
 * POST { householdId, provider: 'google' | 'microsoft' } with a full sign-in adult's JWT. A `returnTo` field is still
 * accepted for compatibility but ignored: the flow always returns to /manage (the tablet does not do OAuth).
 *   200 { url }                       open this URL in the browser (the provider's consent page)
 *   200 { error: 'not_configured' }   the provider's client id/secret, APP_URL or CALENDAR_FINGERPRINT_KEY is not set.
 *                                     Deliberately a 200: it describes what the server offers rather than a failure,
 *                                     so the UI can read it from `functions.invoke`'s `data` and disable the button.
 *   400 { error: 'invalid_request' }  401/403 { error: 'forbidden' }
 *   429 { error: 'rate_limited' }     the member already has 5 unexpired attempts
 *   500 { error: 'internal' }
 *
 * A random `state` and PKCE verifier are generated per attempt; only the state's SHA-256 is stored (with the verifier,
 * the caller's own membership and the provider) and it expires after 10 minutes. The browser comes back to
 * `calendar-oauth-callback`, then the app finishes with `calendar-oauth-finish`.
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
  /** False when APP_URL or the fingerprint key is missing, so the flow could not complete. */
  ready: boolean
  /** Throws an error with `code: 'PT429'` when the member has too many unexpired attempts. */
  createState(input: { stateHash: string; codeVerifier: string; householdId: string; membershipId: string; provider: OAuthProvider }): Promise<void>
}

const json = (status: number, body: unknown) => jsonResponse(status, body, METHODS)

export function createOAuthStartHandler(deps: OAuthStartDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(METHODS)
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const body = await readJsonObject(req)
    const householdId = body?.householdId
    const provider = body?.provider
    if (typeof householdId !== 'string' || !UUID_RE.test(householdId) || (provider !== 'google' && provider !== 'microsoft')) {
      return json(400, { error: 'invalid_request' })
    }

    try {
      const membershipId = await deps.requireFullSignInAdult(req, householdId)
      const client = deps.clients[provider]
      if (!client || !deps.ready) return json(200, { error: 'not_configured' })

      const state = randomUrlToken()
      const codeVerifier = randomUrlToken()
      await deps.createState({ stateHash: await sha256Hex(state), codeVerifier, householdId, membershipId, provider })
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
      if ((e as { code?: unknown } | null)?.code === 'PT429') return json(429, { error: 'rate_limited' })
      console.error('calendar-oauth-start: failed', e instanceof Error ? e.name : 'error', (e as { code?: unknown } | null)?.code ?? '')
      return json(500, { error: 'internal' })
    }
  }
}
