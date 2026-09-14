import { describe, it, expect, vi } from 'vitest'
import { claimDisplay, loadDisplayState, type DisplaySessionClient } from './displaySession'

function fakeClient(opts: { session: boolean; rows: unknown[] }): DisplaySessionClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: opts.session ? { user: { id: 'u' } } : null } }),
      signInAnonymously: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: opts.rows, error: null }),
  } as unknown as DisplaySessionClient
}

describe('loadDisplayState', () => {
  it('is unregistered without a session', async () => {
    expect(await loadDisplayState(fakeClient({ session: false, rows: [] }))).toEqual({ kind: 'unregistered' })
  })

  it('is unregistered when the session has no display', async () => {
    expect(await loadDisplayState(fakeClient({ session: true, rows: [] }))).toEqual({ kind: 'unregistered' })
  })

  it('is registered with identity', async () => {
    const client = fakeClient({
      session: true,
      rows: [{ out_display_id: 'd1', out_household_id: 'h1', out_name: 'Kitchen', out_revoked: false }],
    })
    expect(await loadDisplayState(client)).toEqual({
      kind: 'registered',
      identity: { displayId: 'd1', householdId: 'h1', name: 'Kitchen' },
    })
  })

  it('claimDisplay returns the existing identity when an earlier claim already landed', async () => {
    const client = fakeClient({
      session: true,
      rows: [{ out_display_id: 'd1', out_household_id: 'h1', out_name: 'Kitchen', out_revoked: false }],
    })
    expect(await claimDisplay(client, 'tok')).toEqual({ displayId: 'd1', householdId: 'h1', name: 'Kitchen' })
    expect(client.rpc).not.toHaveBeenCalledWith('claim_display', expect.anything())
  })

  it('is revoked when the display was removed', async () => {
    const client = fakeClient({
      session: true,
      rows: [{ out_display_id: 'd1', out_household_id: 'h1', out_name: 'Kitchen', out_revoked: true }],
    })
    expect(await loadDisplayState(client)).toEqual({ kind: 'revoked' })
  })
})
