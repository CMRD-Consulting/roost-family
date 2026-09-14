import { describe, it, expect, vi } from 'vitest'
import { checkStillRegistered, claimDisplay, loadDisplayState, type DisplaySessionClient } from './displaySession'

function fakeClient(opts: { session: boolean; rows?: unknown; sessionError?: Error; rpcError?: Error }): DisplaySessionClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: opts.session ? { user: { id: 'u' } } : null },
        error: opts.sessionError ?? null,
      }),
      signInAnonymously: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: opts.rpcError ? null : (opts.rows ?? []), error: opts.rpcError ?? null }),
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

  it('throws when the session cannot be read instead of reporting unregistered', async () => {
    const client = fakeClient({ session: false, sessionError: new Error('refresh failed') })
    await expect(loadDisplayState(client)).rejects.toThrow('refresh failed')
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('throws when my_display fails', async () => {
    await expect(loadDisplayState(fakeClient({ session: true, rpcError: new Error('offline') }))).rejects.toThrow('offline')
  })
})

describe('checkStillRegistered', () => {
  it('is active when the heartbeat finds an active display', async () => {
    const client = fakeClient({ session: true, rows: true })
    expect(await checkStillRegistered(client)).toBe('active')
    expect(client.rpc).toHaveBeenCalledWith('display_heartbeat')
  })

  it('is revoked when the heartbeat reports false', async () => {
    expect(await checkStillRegistered(fakeClient({ session: true, rows: false }))).toBe('revoked')
  })

  it('throws on errors rather than guessing', async () => {
    await expect(checkStillRegistered(fakeClient({ session: true, rpcError: new Error('offline') }))).rejects.toThrow('offline')
  })
})
