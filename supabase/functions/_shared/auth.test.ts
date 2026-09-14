import { describe, expect, it, vi } from 'vitest'
import { AuthError, createCallerAuth, type RpcClient, type RpcError } from './auth.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBERSHIP = 'bbbbbbbb-0000-0000-0000-000000000001'
const USER = '11111111-1111-1111-1111-111111111111'

function fakeClients(result: { data?: unknown; error?: RpcError | null }) {
  const calls: Array<{ authorization: string; fn: string; args: unknown }> = []
  const factory = vi.fn((authorization: string): RpcClient => ({
    rpc: async (fn, args) => {
      calls.push({ authorization, fn, args })
      return { data: result.data ?? null, error: result.error ?? null }
    },
  }))
  return { factory, calls }
}

const req = (authorization?: string) =>
  new Request('http://localhost/functions/v1/x', { headers: authorization ? { Authorization: authorization } : {} })

async function authError(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof AuthError) return e
    throw e
  }
  throw new Error('expected an AuthError')
}

describe('callerHousehold', () => {
  it('asks my_calendar_caller with the caller\'s own Authorization header', async () => {
    const { factory, calls } = fakeClients({ data: [{ user_id: USER, kind: 'member', membership_id: MEMBERSHIP }] })
    const caller = await createCallerAuth(factory).callerHousehold(req('Bearer user-jwt'), HOUSEHOLD)
    expect(caller).toEqual({ userId: USER, householdId: HOUSEHOLD, kind: 'member', membershipId: MEMBERSHIP })
    expect(calls).toEqual([{ authorization: 'Bearer user-jwt', fn: 'my_calendar_caller', args: { p_household_id: HOUSEHOLD } }])
  })

  it('returns a display without a membership', async () => {
    const { factory } = fakeClients({ data: [{ user_id: USER, kind: 'display', membership_id: null }] })
    expect(await createCallerAuth(factory).callerHousehold(req('Bearer d'), HOUSEHOLD)).toEqual({
      userId: USER,
      householdId: HOUSEHOLD,
      kind: 'display',
    })
  })

  it('401 without a bearer token, before any database call', async () => {
    const { factory } = fakeClients({})
    for (const header of [undefined, 'Basic abc', 'Bearer ']) {
      expect((await authError(createCallerAuth(factory).callerHousehold(req(header), HOUSEHOLD))).status).toBe(401)
    }
    expect(factory).not.toHaveBeenCalled()
  })

  it('403 when the caller has no relation to the household', async () => {
    const { factory } = fakeClients({ data: [] })
    expect((await authError(createCallerAuth(factory).callerHousehold(req('Bearer x'), HOUSEHOLD))).status).toBe(403)
  })

  it('401 for an expired or invalid JWT', async () => {
    const { factory } = fakeClients({ error: { code: 'PGRST301', message: 'JWT expired' } })
    expect((await authError(createCallerAuth(factory).callerHousehold(req('Bearer x'), HOUSEHOLD))).status).toBe(401)
  })

  it('other database errors are server errors, not auth failures', async () => {
    const { factory } = fakeClients({ error: { code: 'XX000', message: 'boom' } })
    await expect(createCallerAuth(factory).callerHousehold(req('Bearer x'), HOUSEHOLD)).rejects.not.toBeInstanceOf(AuthError)
  })
})

describe('requireFullSignInAdult', () => {
  it('returns the membership id from my_calendar_membership', async () => {
    const { factory, calls } = fakeClients({ data: MEMBERSHIP })
    expect(await createCallerAuth(factory).requireFullSignInAdult(req('Bearer adult'), HOUSEHOLD)).toBe(MEMBERSHIP)
    expect(calls).toEqual([{ authorization: 'Bearer adult', fn: 'my_calendar_membership', args: { p_household_id: HOUSEHOLD } }])
  })

  it('403 when the database refuses (a display, a caregiver, another household)', async () => {
    const { factory } = fakeClients({ error: { code: '42501', message: 'adult sign-in required' } })
    const e = await authError(createCallerAuth(factory).requireFullSignInAdult(req('Bearer display'), HOUSEHOLD))
    expect(e.status).toBe(403)
    expect(e.message).toBe('forbidden')
  })

  it('403 when no membership id comes back', async () => {
    const { factory } = fakeClients({ data: null })
    expect((await authError(createCallerAuth(factory).requireFullSignInAdult(req('Bearer x'), HOUSEHOLD))).status).toBe(403)
  })
})
