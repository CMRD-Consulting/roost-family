import { describe, expect, it, vi } from 'vitest'
import { oauthProviderApi, type OAuthProvider } from '../_shared/oauthProviders.ts'
import { sha256Hex } from '../_shared/pkce.ts'
import { createOAuthCallbackHandler, type ConsumedState, type OAuthCallbackDeps } from './handler.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const CALLBACK = 'http://127.0.0.1:55321/functions/v1/calendar-oauth-callback'
const APP = 'http://localhost:5173'
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const NOW = new Date('2026-09-14T16:00:00Z')

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
        json(200, { access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', id_token: idToken({ email: 'sam@example.com' }) })
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
  const d: OAuthCallbackDeps = {
    consumeState: vi.fn(async (hash: string) => {
      consumed.push(hash)
      return state
    }),
    clients: { google: { clientId: 'gid', clientSecret: 'gsecret' }, microsoft: { clientId: 'mid', clientSecret: 'msecret' } },
    api: (provider: OAuthProvider) => oauthProviderApi(provider, fetch),
    redirectUri: CALLBACK,
    appUrl: APP,
    createConnection: vi.fn(async () => 'conn-1'),
    addSelection: vi.fn(async () => 'sel'),
    now: () => NOW,
    ...overrides,
  }
  return { d, consumed }
}

const attempt = (overrides: Partial<ConsumedState> = {}): ConsumedState => ({
  householdId: HOUSEHOLD,
  membershipId: MEMBERSHIP,
  provider: 'google',
  codeVerifier: VERIFIER,
  redirectTo: 'settings',
  expired: false,
  ...overrides,
})

const get = (query: string) => new Request(`${CALLBACK}?${query}`)

function location(res: Response): URL {
  expect(res.status).toBe(302)
  return new URL(res.headers.get('Location')!)
}

describe('calendar-oauth-callback handler', () => {
  it('connects the account: code exchanged with the verifier, connection labelled with the email, calendars recorded hidden', async () => {
    const { fetch, calls } = googleFetch()
    const { d, consumed } = deps(attempt({ redirectTo: 'manage' }), fetch)
    const res = await createOAuthCallbackHandler(d)(get('state=the-state&code=auth-code&scope=x'))
    const to = location(res)
    expect(`${to.origin}${to.pathname}`).toBe(`${APP}/manage`)
    expect(Object.fromEntries(to.searchParams)).toEqual({ calendar: 'connected' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')

    expect(consumed).toEqual([await sha256Hex('the-state')])
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body!))).toMatchObject({ code: 'auth-code', code_verifier: VERIFIER, redirect_uri: CALLBACK })
    expect(d.createConnection).toHaveBeenCalledWith({ householdId: HOUSEHOLD, membershipId: MEMBERSHIP, provider: 'google', label: 'sam@example.com', secret: 'refresh-1' })
    expect(vi.mocked(d.addSelection).mock.calls.map((c) => c[0])).toEqual([
      { connectionId: 'conn-1', externalCalendarId: 'sam@example.com', name: 'sam@example.com' },
      { connectionId: 'conn-1', externalCalendarId: 'kids@group.calendar.google.com', name: 'Kids' },
    ])
    expect(res.headers.get('Location')).not.toMatch(/refresh-1|access-1|auth-code/)
  })

  it('labels the connection "Google Calendar" / "Outlook Calendar" without an email', async () => {
    const { fetch } = googleFetch({ token: json(200, { access_token: 'a', refresh_token: 'r' }) })
    const { d } = deps(attempt(), fetch)
    await createOAuthCallbackHandler(d)(get('state=s&code=c'))
    expect(d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ label: 'Google Calendar' }))

    const msFetch = vi.fn(async (url: string) =>
      url.includes('/oauth2/v2.0/token') ? json(200, { access_token: 'a', refresh_token: 'r' }) : json(200, { value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true }] }),
    )
    const ms = deps(attempt({ provider: 'microsoft' }), msFetch)
    expect(Object.fromEntries(location(await createOAuthCallbackHandler(ms.d)(get('state=s&code=c'))).searchParams)).toEqual({ calendar: 'connected' })
    expect(ms.d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ provider: 'microsoft', label: 'Outlook Calendar', secret: 'r' }))
  })

  it('refuses a missing, unknown or used state before any provider call', async () => {
    for (const query of ['code=c', 'state=&code=c', `state=${'x'.repeat(600)}&code=c`, 'state=unknown&code=c']) {
      const { fetch } = googleFetch()
      const { d } = deps(null, fetch)
      const to = location(await createOAuthCallbackHandler(d)(get(query)))
      expect(`${to.pathname}?${to.searchParams}`).toBe('/settings?calendar=error&reason=invalid_state')
      expect(fetch).not.toHaveBeenCalled()
      expect(d.createConnection).not.toHaveBeenCalled()
    }
  })

  it('refuses an expired state', async () => {
    const { fetch } = googleFetch()
    const { d } = deps(attempt({ expired: true, redirectTo: 'manage' }), fetch)
    const to = location(await createOAuthCallbackHandler(d)(get('state=s&code=c')))
    expect(`${to.pathname}?${to.searchParams}`).toBe('/manage?calendar=error&reason=expired')
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
    expect(d.createConnection).not.toHaveBeenCalled()
  })

  it('reports an exchange failure without logging the code or tokens', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetch } = googleFetch({ token: json(400, { error: 'invalid_grant', error_description: 'Bad code auth-code-zz' }) })
    const { d } = deps(attempt(), fetch)
    const to = location(await createOAuthCallbackHandler(d)(get('state=s&code=auth-code-zz')))
    expect(to.searchParams.get('reason')).toBe('exchange_failed')
    expect(d.createConnection).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('auth-code-zz')
    log.mockRestore()
  })

  it('refuses a token response without a refresh token', async () => {
    const { fetch } = googleFetch({ token: json(200, { access_token: 'a', expires_in: 3600 }) })
    const { d } = deps(attempt(), fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('no_refresh_token')
    expect(d.createConnection).not.toHaveBeenCalled()
  })

  it('creates nothing when the calendars cannot be listed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fetch } = googleFetch({ list: json(503, { error: { code: 503 } }) })
    const { d } = deps(attempt(), fetch)
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('list_failed')
    expect(d.createConnection).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('reports forbidden when the member can no longer connect, and not_configured without a client', async () => {
    let { d } = deps(attempt(), googleFetch().fetch, {
      createConnection: vi.fn(async () => {
        throw Object.assign(new Error('member not found'), { code: '42501' })
      }),
    })
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('forbidden')
    ;({ d } = deps(attempt(), googleFetch().fetch, { clients: { google: null, microsoft: null } }))
    expect(location(await createOAuthCallbackHandler(d)(get('state=s&code=c'))).searchParams.get('reason')).toBe('not_configured')
  })

  it('never uses a URL-like email as the label', async () => {
    const { fetch } = googleFetch({ token: json(200, { access_token: 'a', refresh_token: 'r', id_token: idToken({ email: 'x@https://evil.test' }) }) })
    const { d } = deps(attempt(), fetch)
    await createOAuthCallbackHandler(d)(get('state=s&code=c'))
    expect(d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ label: 'Google Calendar' }))
  })
})
