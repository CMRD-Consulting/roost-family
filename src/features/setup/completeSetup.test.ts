import { describe, it, expect, vi } from 'vitest'
import { completeSetup } from './completeSetup'

describe('completeSetup', () => {
  it('creates the household, kids, PIN and display, claims the display, then ends the adult session', async () => {
    const calls: string[] = []
    const adultRpc = vi.fn(async (fn: string) => {
      calls.push(fn)
      if (fn === 'create_household') return { data: 'h1', error: null }
      if (fn === 'add_child') return { data: `c${calls.length}`, error: null }
      if (fn === 'register_display') return { data: [{ out_display_id: 'd1', out_claim_token: 'tok' }], error: null }
      return { data: null, error: null }
    })
    const end = vi.fn(async () => { calls.push('end') })
    const claim = vi.fn(async () => {
      calls.push('claim')
      return { displayId: 'd1', householdId: 'h1', name: 'Kitchen' }
    })

    const identity = await completeSetup(
      {
        inviteCode: 'roost1',
        householdName: 'Rivera',
        zip: '28202',
        timeZone: 'America/New_York',
        lat: null,
        lon: null,
        kids: [
          { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' },
          { name: 'Theo', birthday: '2025-06-02', color: '#8A56AC' },
        ],
        displayName: 'Sam',
        color: '#5B6ACF',
        pin: '1234',
        displayLabel: 'Kitchen',
      },
      { client: { rpc: adultRpc } as never, userId: 'u1', email: 'sam@roost.test', end },
      claim,
    )

    expect(identity).toEqual({ displayId: 'd1', householdId: 'h1', name: 'Kitchen' })
    expect(calls).toEqual(['create_household', 'add_child', 'add_child', 'set_my_pin', 'register_display', 'claim', 'end'])
    expect(adultRpc).toHaveBeenCalledWith('create_household', expect.objectContaining({ p_invite_code: 'ROOST1', p_name: 'Rivera' }))
    expect(claim).toHaveBeenCalledWith('tok')
  })

  it('surfaces RPC errors', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'invalid invite code' } }))
    await expect(
      completeSetup(
        {
          inviteCode: 'NOPE00', householdName: 'X', zip: '', timeZone: 'America/New_York', lat: null, lon: null,
          kids: [], displayName: 'Sam', color: '#5B6ACF', pin: '1234', displayLabel: 'Kitchen',
        },
        { client: { rpc } as never, userId: 'u1', email: 'x@y.z', end: vi.fn() },
        vi.fn(),
      ),
    ).rejects.toThrow('invalid invite code')
  })
})
