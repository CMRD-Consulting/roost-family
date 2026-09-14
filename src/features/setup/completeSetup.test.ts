import { describe, it, expect, vi } from 'vitest'
import {
  completeSetup,
  adultOwnsHousehold,
  isInvalidInviteError,
  registerDisplayErrorMessage,
  CLAIM_TOKEN_TTL_MS,
  type SetupInput,
  type SetupProgress,
} from './completeSetup'

const IDENTITY = { displayId: 'd1', householdId: 'h1', name: 'Kitchen' }

function input(overrides: Partial<SetupInput & SetupProgress> = {}): SetupInput & SetupProgress {
  return {
    inviteCode: 'roost1',
    householdName: ' Rivera ',
    zip: '28202',
    timeZone: 'America/New_York',
    lat: null,
    lon: null,
    kids: [
      { name: 'Ivy ', birthday: '2023-04-10', color: '#C2477A' },
      { name: 'Theo', birthday: '2025-06-02', color: '#8A56AC' },
    ],
    displayName: 'Sam',
    color: '#5B6ACF',
    pin: '1234',
    displayLabel: 'Kitchen',
    householdId: null,
    displayClaim: null,
    ...overrides,
  }
}

function harness(opts: { claimFailures?: number } = {}) {
  const calls: string[] = []
  let tokens = 0
  let claimFailures = opts.claimFailures ?? 0
  const rpc = vi.fn(async (fn: string, _args?: unknown) => {
    calls.push(fn)
    if (fn === 'setup_household') return { data: 'h1', error: null }
    if (fn === 'register_display') {
      tokens += 1
      return { data: [{ out_display_id: 'd1', out_claim_token: `tok${tokens}` }], error: null }
    }
    return { data: null, error: null }
  })
  const end = vi.fn(async () => {
    calls.push('end')
  })
  const claim = vi.fn(async (_token: string) => {
    calls.push('claim')
    if (claimFailures > 0) {
      claimFailures -= 1
      throw new Error('network down')
    }
    return IDENTITY
  })
  const adult = { client: { rpc } as never, end }
  return { calls, rpc, end, claim, adult }
}

describe('completeSetup', () => {
  it('sets up the household in one call, registers, claims, then ends the adult session', async () => {
    const h = harness()
    const state = input()

    const identity = await completeSetup(state, h.adult, h.claim, () => 1_000)

    expect(identity).toEqual(IDENTITY)
    expect(h.calls).toEqual(['setup_household', 'register_display', 'claim', 'end'])
    expect(h.rpc).toHaveBeenCalledWith('setup_household', {
      p_name: 'Rivera',
      p_time_zone: 'America/New_York',
      p_zip: '28202',
      p_lat: null,
      p_lon: null,
      p_invite_code: 'ROOST1',
      p_display_name: 'Sam',
      p_color: '#5B6ACF',
      p_kids: [
        { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' },
        { name: 'Theo', birthday: '2025-06-02', color: '#8A56AC' },
      ],
      p_pin: '1234',
    })
    expect(h.rpc).toHaveBeenCalledWith('register_display', { p_household_id: 'h1', p_name: 'Kitchen' })
    expect(h.claim).toHaveBeenCalledWith('tok1')
    expect(state.householdId).toBe('h1')
    expect(state.displayClaim).toEqual({ token: 'tok1', expiresAt: 1_000 + CLAIM_TOKEN_TTL_MS - 30_000 })
  })

  it('does not end the adult session when the claim fails', async () => {
    const h = harness({ claimFailures: 1 })
    await expect(completeSetup(input(), h.adult, h.claim, () => 0)).rejects.toThrow('network down')
    expect(h.end).not.toHaveBeenCalled()
  })

  it('on retry after a failed claim, reuses the household and the unexpired token', async () => {
    const h = harness({ claimFailures: 1 })
    const state = input()
    let clock = 0
    await expect(completeSetup(state, h.adult, h.claim, () => clock)).rejects.toThrow('network down')

    clock = 5 * 60_000
    const identity = await completeSetup(state, h.adult, h.claim, () => clock)

    expect(identity).toEqual(IDENTITY)
    expect(h.calls).toEqual(['setup_household', 'register_display', 'claim', 'claim', 'end'])
    expect(h.claim).toHaveBeenLastCalledWith('tok1')
  })

  it('registers again when the saved token has expired', async () => {
    const h = harness({ claimFailures: 1 })
    const state = input()
    let clock = 0
    await expect(completeSetup(state, h.adult, h.claim, () => clock)).rejects.toThrow('network down')

    clock = CLAIM_TOKEN_TTL_MS - 30_000
    await completeSetup(state, h.adult, h.claim, () => clock)

    expect(h.calls).toEqual(['setup_household', 'register_display', 'claim', 'register_display', 'claim', 'end'])
    expect(h.claim).toHaveBeenLastCalledWith('tok2')
  })

  it('surfaces RPC errors without recording progress', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'invalid invite code' } }))
    const end = vi.fn()
    const state = input({ inviteCode: 'NOPE00' })
    const error = await completeSetup(state, { client: { rpc } as never, end }, vi.fn()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(isInvalidInviteError(error)).toBe(true)
    expect(state.householdId).toBeNull()
    expect(end).not.toHaveBeenCalled()
  })
})

describe('registerDisplayErrorMessage', () => {
  it('explains the display limit and where to remove one', () => {
    expect(registerDisplayErrorMessage('a household can have at most 3 displays', 'Rivera')).toBe(
      'Rivera already has 3 displays. Remove one in Settings → Displays or at roost.cmrd.dev/manage, then try again.',
    )
  })

  it('passes other messages through', () => {
    expect(registerDisplayErrorMessage('Failed to fetch', 'Rivera')).toBe('Failed to fetch')
  })
})

describe('adultOwnsHousehold', () => {
  function client(rows: unknown[]) {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: rows, error: null })),
    }
    return { from: vi.fn(() => query), query }
  }

  it('is true when the adult has an active owner membership', async () => {
    const c = client([{ id: 'm1' }])
    expect(await adultOwnsHousehold({ client: c as never, userId: 'u1' })).toBe(true)
    expect(c.from).toHaveBeenCalledWith('memberships')
    expect(c.query.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(c.query.eq).toHaveBeenCalledWith('role', 'owner')
  })

  it('is false without one', async () => {
    expect(await adultOwnsHousehold({ client: client([]) as never, userId: 'u1' })).toBe(false)
  })
})
