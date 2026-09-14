import { describe, expect, it, vi } from 'vitest'
import { oauthProviderApi, type OAuthProvider } from '../_shared/oauthProviders.ts'
import { hmacSha256Hex, sha256Hex } from '../_shared/pkce.ts'
import { createOAuthCallbackHandler, type ConsumedState, type OAuthCallbackDeps, type PendingAttempt } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const CALLBACK = 'http://127.0.0.1:55321/functions/v1/calendar-oauth-callback'
const APP = 'http://localhost:5173'
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const NOW = new Date('2026-09-14T16:00:00Z')
const KEY = 'k'.repeat(32)

function idToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake Google: token endpoint and calendar list. */
function googleFetch(options: { token?: Response; list?: Response } = {}) {
  const calls: Array<{ url: string; body: string | null }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : null })
    if (url === 'https://oauth2.googleapis.com/token') {
      return (
        options.token ??
        json(200, { access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', id_token: idToken({ sub: 'google-sub-1', email: 'sam@example.com' }) })
      )
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
      return (
        options.list ??
        json(200, {
          items: [
            { id: 'kids@group.calendar.google.com', summary: 'Kids' },
            { id: 'sam@example.com', summary: 'sam@example.com', primary: true },
          ],
        })
      )
    }
    throw new Error(`unexpected ${url}`)
  })
  return { fetch, calls }
}

function deps(state: ConsumedState | null, fetch = googleFetch().fetch, overrides: Partial<OAuthCallbackDeps> = {}) {
  const consumed: string[] = []
  const attempts: PendingAttempt[] = []
  const d: OAuthCallbackDeps = {
    consumeState: vi.fn(async (hash: string) => {
      consumed.push(hash)
      return state
    }),
    clients: { google: { clientId: 'gid', clientSecret: 'gsecret' }, microsoft: { clientId: 'mid', clientSecret: 'msecret' } },
    api: (provider: OAuthProvider) => oauthProviderApi(provider, fetch),
    redirectUri: CALLBACK,
    appUrl: APP,
    fingerprint: (value) => hmacSha256Hex(KEY, value),
    createAttempt: vi.fn(async (attempt: PendingAttempt) => {
      attempts.push(attempt)
    }),
    now: () => NOW,
    ...overrides,
  }
  return { d, consumed, attempts }
}

const attempt = (overrides: Partial<ConsumedState> = {}): ConsumedState => ({
  householdId: HOUSEHOLD,
  membershipId: MEMBERSHIP,
  provider: 'google',
  codeVerifier: VERIFIER,
  expired: false,
  ...overrides,
})

const get = (query: string) => new Request(`${CALLBACK}?${query}`)

function location(res: Response): URL {
  expect(res.status).toBe(302)
  const to = new URL(res.headers.get('Location')!)
  expect(`${to.origin}${to.pathname}`).toBe(`${APP}/manage`)
  return to
}

describe('calendar-oauth-callback handler', () => {
  it('parks the consent as a pending attempt instead of connecting, and hands the browser a one-time token', async () => {
    const { fetch, calls } = googleFetch()
    const { d, consumed, attempts } = deps(attempt(), fetch)
    const res = await createOAuthCallbackHandler(d)(get('state=the-state&code=auth-code&scope=x'))
    const to = location(res)
    expect(to.searchParams.get('calendar')).toBe('pending')
    const token = to.searchParams.get('attempt')!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect([...to.searchParams.keys()].sort()).toEqual(['attempt', 'calendar'])
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')

    expect(consumed).toEqual([await sha256Hex('the-state')])
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body!))).toMatchObject({ code: 'auth-code', code_verifier: VERIFIER, redirect_uri: CALLBACK })
    expect(attempts).toEqual([
      {
        attemptHash: await sha256Hex(token),
        householdId: HOUSEHOLD,
        membershipId: MEMBERSHIP,
        provider: 'google',
        secret: 'refresh-1',
        accountLabel: 'sam@example.com',
        fingerprint: await hmacSha256Hex(KEY, 'google:google-sub-1'),
        calendars: [
          { id: 'sam@example.com', name: 'sam@example.com' },
          { id: 'kids@group.calendar.google.com', name: 'Kids' },
        ],
      },
    ])
    expect(JSON.stringify(attempts)).not.toContain(token)
    expect(res.headers.get('Location')).not.toMatch(/refresh-1|access-1|auth-code/)
  })

  it('fingerprints Microsoft accounts by oid, and leaves the label empty without an email', async () => {
    const msFetch = vi.fn(async (url: string) =>
      url.includes('/oauth2/v2.0/token')
        ? json(200, { access_token: 'a', refresh_token: 'r', id_token: idToken({ oid: 'object-1', sub: 'pairwise-1' }) })
        : json(200, { value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true }] }),
    )
    const { d, attempts } = deps(attempt({ provider: 'microsoft' }), msFetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('calendar')).toBe('pending')
    expect(attempts[0]).toMatchObject({ provider: 'microsoft', accountLabel: null, secret: 'r', fingerprint: await hmacSha256Hex(KEY, 'microsoft:object-1') })
  })

  it('refuses a missing, unknown or used state before any provider call', async () => {
    for (const query of ['code=c', 'state=&code=c', `state=${'x'.repeat(600)}&code=c`, 'state=unknown&code=c']) {
      const { fetch } = googleFetch()
      const { d } = deps(null, fetch)
      const to = location(await createOAuthCallbackHandler(d)(get(query)))
      expect(Object.fromEntries(to.searchParams)).toEqual({ calendar: 'error', reason: 'invalid_state' })
      expect(fetch).not.toHaveBeenCalled()
      expect(d.createAttempt).not.toHaveBeenCalled()
    }
  })

  it('refuses an expired state', async () => {
    const { fetch } = googleFetch()
    const { d } = deps(attempt({ expired: true }), fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('expired')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('handles a declined consent and other provider errors (consuming the state)', async () => {
    let { d, consumed } = deps(attempt())
    let to = location(await createOAuthCallbackHandler(d)(get('state=s&error=access_denied&error_description=The+user+declined')))
    expect(to.searchParams.get('reason')).toBe('access_denied')
    expect(consumed).toHaveLength(1)
    ;({ d } = deps(attempt()))
    to = location(await createOAuthCallbackHandler(d)(get('state=s&error=server_error')))
    expect(to.searchParams.get('reason')).toBe('provider_error')
    ;({ d } = deps(attempt()))
    to = location(await createOAuthCallbackHandler(d)(get('state=s')))
    expect(to.searchParams.get('reason')).toBe('provider_error')
    expect(d.createAttempt).not.toHaveBeenCalled()
  })

  it('reports an exchange failure without logging the code or tokens', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetch } = googleFetch({ token: json(400, { error: 'invalid_grant', error_description: 'Bad code auth-code-zz' }) })
    const { d } = deps(attempt(), fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=auth-code-zz'))).searchParams.get('reason')).toBe('exchange_failed')
    expect(d.createAttempt).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('auth-code-zz')
    log.mockRestore()
  })

  it('refuses a token response without a refresh token or without an account id', async () => {
    let { d } = deps(attempt(), googleFetch({ token: json(200, { access_token: 'a', expires_in: 3600, id_token: idToken({ sub: 'x' }) }) }).fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('no_refresh_token')
    ;({ d } = deps(attempt(), googleFetch({ token: json(200, { access_token: 'a', refresh_token: 'r' }) }).fetch))
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('provider_error')
    expect(d.createAttempt).not.toHaveBeenCalled()
  })

  it('stores nothing when the calendars cannot be listed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { d } = deps(attempt(), googleFetch({ list: json(503, { error: { code: 503 } }) }).fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('list_failed')
    expect(d.createAttempt).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('reports forbidden, not_configured, and internal errors', async () => {
    let { d } = deps(attempt(), googleFetch().fetch, {
      createAttempt: vi.fn(async () => {
        throw Object.assign(new Error('member not found'), { code: '42501' })
      }),
    })
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('forbidden')
    ;({ d } = deps(attempt(), googleFetch().fetch, { clients: { google: null, microsoft: null } }))
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('not_configured')
    ;({ d } = deps(attempt(), googleFetch().fetch, { fingerprint: null }))
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('not_configured')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;({ d } = deps(attempt(), googleFetch().fetch, { createAttempt: vi.fn(async () => { throw new Error('db down') }) }))
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('internal')
    log.mockRestore()
  })

  it('fails closed with 503 when APP_URL is not configured, consuming nothing', async () => {
    const { d } = deps(attempt(), googleFetch().fetch, { appUrl: null })
    const res = await createOAuthCallbackHandler(d)(get('state=s&code=c'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(d.consumeState).not.toHaveBeenCalled()
  })

  it('never uses a URL-like email as the label', async () => {
    const { fetch } = googleFetch({ token: json(200, { access_token: 'a', refresh_token: 'r', id_token: idToken({ sub: 's', email: 'x@https://evil.test' }) }) })
    const { d, attempts } = deps(attempt(), fetch)
    await createOAuthCallbackHandler(d)(get('state=s&code=c'))
    expect(attempts[0]!.accountLabel).toBeNull()
  })
})
