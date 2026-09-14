import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { oauthProviderApi } from '../_shared/oauthProviders.ts'
import { s256Challenge, sha256Hex } from '../_shared/pkce.ts'
import { createOAuthStartHandler, type OAuthStartDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-oauth-start'
const REDIRECT = 'https://project.supabase.co/functions/v1/calendar-oauth-callback'

function deps(overrides: Partial<OAuthStartDeps> = {}): OAuthStartDeps {
  const noFetch = vi.fn(async () => {
    throw new Error('no network in start')
  })
  return {
    requireFullSignInAdult: vi.fn(async () => MEMBERSHIP),
    clients: { google: { clientId: 'google-id', clientSecret: 'google-secret' }, microsoft: { clientId: 'ms-id', clientSecret: 'ms-secret' } },
    api: (provider) => oauthProviderApi(provider, noFetch),
    redirectUri: REDIRECT,
    createState: vi.fn(async () => {}),
    ...overrides,
  }
}

const post = (body: unknown) =>
  new Request(ENDPOINT, { method: 'POST', headers: { Authorization: 'Bearer adult', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('calendar-oauth-start handler', () => {
  it('RFC 7636 S256 test vector', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('returns the Google consent URL with the PKCE challenge, storing only the state hash and the verifier', async () => {
    const d = deps()
    const res = await createOAuthStartHandler(d)(post({ householdId: HOUSEHOLD, provider: 'google', returnTo: 'manage', membershipId: 'someone-else' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const { url } = (await res.json()) as { url: string }
    const params = new URL(url).searchParams
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    expect(params.get('client_id')).toBe('google-id')
    expect(params.get('redirect_uri')).toBe(REDIRECT)
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('access_type')).toBe('offline')
    expect(params.get('prompt')).toBe('consent')
    expect(url).not.toContain('google-secret')

    const state = params.get('state')!
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = vi.mocked(d.createState).mock.calls[0]![0]
    expect(stored).toEqual({
      stateHash: await sha256Hex(state),
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      householdId: HOUSEHOLD,
      membershipId: MEMBERSHIP,
      provider: 'google',
      redirectTo: 'manage',
    })
    expect(stored.stateHash).not.toContain(state)
    expect(params.get('code_challenge')).toBe(await s256Challenge(stored.codeVerifier))
    expect(url).not.toContain(stored.codeVerifier)
  })

  it('returns the Microsoft consent URL, returning to Settings by default, with a fresh state each time', async () => {
    const d = deps()
    const first = (await (await createOAuthStartHandler(d)(post({ householdId: HOUSEHOLD, provider: 'microsoft' }))).json()) as { url: string }
    const second = (await (await createOAuthStartHandler(d)(post({ householdId: HOUSEHOLD, provider: 'microsoft' }))).json()) as { url: string }
    const params = new URL(first.url).searchParams
    expect(first.url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?')).toBe(true)
    expect(params.get('scope')).toBe('openid email offline_access Calendars.Read')
    expect(vi.mocked(d.createState).mock.calls[0]![0].redirectTo).toBe('settings')
    expect(new URL(second.url).searchParams.get('state')).not.toBe(params.get('state'))
  })

  it('answers not_configured (200) without storing a state when the provider has no client', async () => {
    const d = deps({ clients: { google: null, microsoft: { clientId: 'ms-id', clientSecret: 's' } } })
    const res = await createOAuthStartHandler(d)(post({ householdId: HOUSEHOLD, provider: 'google' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(d.createState).not.toHaveBeenCalled()
  })

  it('refuses callers who are not full sign-in adults', async () => {
    const d = deps({ requireFullSignInAdult: vi.fn(async () => { throw new AuthError(403, 'forbidden') }) })
    const res = await createOAuthStartHandler(d)(post({ householdId: HOUSEHOLD, provider: 'google' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(d.createState).not.toHaveBeenCalled()
  })

  it('rejects malformed requests', async () => {
    const d = deps()
    for (const body of [
      { householdId: 'x', provider: 'google' },
      { householdId: HOUSEHOLD, provider: 'ics' },
      { householdId: HOUSEHOLD, provider: 'google', returnTo: 'https://evil.test' },
    ]) {
      const res = await createOAuthStartHandler(d)(post(body))
      expect(res.status).toBe(400)
    }
    expect(d.requireFullSignInAdult).not.toHaveBeenCalled()
  })
})
