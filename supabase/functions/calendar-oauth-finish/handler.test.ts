import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../_shared/auth.ts'
import { randomUrlToken, sha256Hex } from '../_shared/pkce.ts'
import { createOAuthFinishHandler, type FinishOutcome, type OAuthFinishDeps } from './handler.ts'

const ATTACKER_HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-00000000000a'
const VICTIM_HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-00000000000b'
const ATTACKER = 'bbbbbbbb-0000-0000-0000-00000000000a'
const VICTIM = 'bbbbbbbb-0000-0000-0000-00000000000b'
const ENDPOINT = 'http://127.0.0.1:55321/functions/v1/calendar-oauth-finish'

interface StoredAttempt {
  householdId: string
  membershipId: string
  expired: boolean
  calendars: number
}

/** An in-memory stand-in with the same rules as private.finish_calendar_oauth_attempt. */
function fakeAttempts(initial: Record<string, StoredAttempt>) {
  const rows = new Map(Object.entries(initial))
  const connections: Array<{ membershipId: string; calendars: number }> = []
  return {
    rows,
    connections,
    peekAttempt: vi.fn(async (hash: string) => (rows.has(hash) ? { householdId: rows.get(hash)!.householdId } : null)),
    finishAttempt: vi.fn(async (hash: string, membershipId: string): Promise<FinishOutcome> => {
      const row = rows.get(hash)
      if (!row) return { outcome: 'invalid_attempt' }
      if (row.expired) {
        rows.delete(hash)
        return { outcome: 'expired' }
      }
      if (row.membershipId !== membershipId) return { outcome: 'forbidden' }
      rows.delete(hash)
      connections.push({ membershipId, calendars: row.calendars })
      return { outcome: 'ok', connectionId: 'conn-1', label: 'sam@example.com', calendarCount: row.calendars }
    }),
  }
}

/** The caller's full sign-in memberships by household. */
function signedInAs(memberships: Record<string, string>) {
  return vi.fn(async (_req: Request, householdId: string) => {
    const membership = memberships[householdId]
    if (!membership) throw new AuthError(403, 'forbidden')
    return membership
  })
}

const post = (body: unknown, authorization = 'Bearer adult') =>
  new Request(ENDPOINT, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function call(d: OAuthFinishDeps, body: unknown) {
  const res = await createOAuthFinishHandler(d)(post(body))
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers }
}

describe('calendar-oauth-finish handler', () => {
  it('connects when the adult who started the attempt finishes it', async () => {
    const token = randomUrlToken()
    const store = fakeAttempts({ [await sha256Hex(token)]: { householdId: VICTIM_HOUSEHOLD, membershipId: VICTIM, expired: false, calendars: 3 } })
    const requireFullSignInAdult = signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM })
    const res = await call({ ...store, requireFullSignInAdult }, { attempt: token })
    expect(res).toMatchObject({ status: 200, body: { connectionId: 'conn-1', calendars: 3, label: 'sam@example.com' } })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(requireFullSignInAdult).toHaveBeenCalledWith(expect.any(Request), VICTIM_HOUSEHOLD)
    expect(store.finishAttempt).toHaveBeenCalledWith(await sha256Hex(token), VICTIM)
    expect(store.connections).toEqual([{ membershipId: VICTIM, calendars: 3 }])
  })

  it('refuses an attacker\'s attempt finished in the victim\'s session, without consuming it', async () => {
    const token = randomUrlToken()
    const hash = await sha256Hex(token)
    // The attacker started OAuth in their own household; the victim consented and lands on /manage signed in as themselves.
    let store = fakeAttempts({ [hash]: { householdId: ATTACKER_HOUSEHOLD, membershipId: ATTACKER, expired: false, calendars: 2 } })
    let res = await call({ ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }, { attempt: token })
    expect(res).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect(store.finishAttempt).not.toHaveBeenCalled()
    expect(store.rows.has(hash)).toBe(true)

    // Even when the victim is also an adult of the attacker's household, the attempt belongs to the attacker.
    store = fakeAttempts({ [hash]: { householdId: ATTACKER_HOUSEHOLD, membershipId: ATTACKER, expired: false, calendars: 2 } })
    res = await call({ ...store, requireFullSignInAdult: signedInAs({ [ATTACKER_HOUSEHOLD]: VICTIM }) }, { attempt: token })
    expect(res).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect(store.rows.has(hash)).toBe(true)
    expect(store.connections).toEqual([])
  })

  it('refuses a replayed attempt', async () => {
    const token = randomUrlToken()
    const store = fakeAttempts({ [await sha256Hex(token)]: { householdId: VICTIM_HOUSEHOLD, membershipId: VICTIM, expired: false, calendars: 1 } })
    const d = { ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }
    expect((await call(d, { attempt: token })).status).toBe(200)
    expect(await call(d, { attempt: token })).toMatchObject({ status: 404, body: { error: 'invalid_attempt' } })
    expect(store.connections).toHaveLength(1)
  })

  it('reports a race where the attempt disappears between the check and the finish as invalid_attempt', async () => {
    const token = randomUrlToken()
    const store = fakeAttempts({})
    store.peekAttempt.mockResolvedValueOnce({ householdId: VICTIM_HOUSEHOLD })
    const res = await call({ ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }, { attempt: token })
    expect(res).toMatchObject({ status: 404, body: { error: 'invalid_attempt' } })
  })

  it('reports an expired attempt as expired', async () => {
    const token = randomUrlToken()
    const hash = await sha256Hex(token)
    const store = fakeAttempts({ [hash]: { householdId: VICTIM_HOUSEHOLD, membershipId: VICTIM, expired: true, calendars: 1 } })
    const res = await call({ ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }, { attempt: token })
    expect(res).toMatchObject({ status: 410, body: { error: 'expired' } })
    expect(store.rows.has(hash)).toBe(false)
  })

  it('rejects malformed tokens without touching the store', async () => {
    const store = fakeAttempts({})
    const d = { ...store, requireFullSignInAdult: signedInAs({}) }
    for (const body of [{}, { attempt: 'short' }, { attempt: 42 }, { attempt: `${'a'.repeat(42)}!` }]) {
      expect(await call(d, body)).toMatchObject({ status: 400, body: { error: 'invalid_request' } })
    }
    expect(store.peekAttempt).not.toHaveBeenCalled()
  })

  it('maps a membership that changed meanwhile to forbidden, no JWT to 401, other failures to 500', async () => {
    const token = randomUrlToken()
    const hash = await sha256Hex(token)
    const row = { householdId: VICTIM_HOUSEHOLD, membershipId: VICTIM, expired: false, calendars: 1 }
    let store = fakeAttempts({ [hash]: row })
    store.finishAttempt.mockRejectedValueOnce(Object.assign(new Error('member not found'), { code: '42501' }))
    expect((await call({ ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }, { attempt: token })).status).toBe(403)

    store = fakeAttempts({ [hash]: row })
    const noJwt = vi.fn(async () => {
      throw new AuthError(401, 'sign-in required')
    })
    expect(await call({ ...store, requireFullSignInAdult: noJwt }, { attempt: token })).toMatchObject({ status: 401, body: { error: 'forbidden' } })

    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store = fakeAttempts({ [hash]: row })
    store.finishAttempt.mockRejectedValueOnce(new Error('db down'))
    expect(await call({ ...store, requireFullSignInAdult: signedInAs({ [VICTIM_HOUSEHOLD]: VICTIM }) }, { attempt: token })).toMatchObject({
      status: 500,
      body: { error: 'internal' },
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(token)
    log.mockRestore()
  })
})
