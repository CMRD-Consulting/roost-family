import { describe, it, expect, vi, afterEach } from 'vitest'
import { isReactive, reactive } from 'vue'
import { disposeAdultClient, verifyEmailCode } from './adultSession'

vi.mock('@/data/supabase', () => ({ createAdultClient: vi.fn() }))

afterEach(() => vi.useRealTimers())

function fakeAuth(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const auth = {
    stopAutoRefresh: vi.fn(async () => void calls.push('stopAutoRefresh')),
    signOut: vi.fn(async () => {
      calls.push('signOut')
      return { error: null }
    }),
    dispose: vi.fn(async () => void calls.push('dispose')),
    verifyOtp: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'sam@roost.test' } }, error: null })),
    ...overrides,
  }
  return { auth, calls }
}

describe('disposeAdultClient', () => {
  it('stops refresh, signs out locally, then disposes', async () => {
    const { auth, calls } = fakeAuth()
    await disposeAdultClient({ auth } as never)
    expect(calls).toEqual(['stopAutoRefresh', 'signOut', 'dispose'])
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('gives up on a hung sign-out after the timeout and still disposes', async () => {
    vi.useFakeTimers()
    const { auth, calls } = fakeAuth({ signOut: vi.fn(() => new Promise(() => {})) })
    const done = disposeAdultClient({ auth } as never, 5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await done
    expect(calls).toEqual(['stopAutoRefresh', 'dispose'])
  })

  it('never throws, and works without dispose', async () => {
    const { auth } = fakeAuth({
      stopAutoRefresh: vi.fn(async () => {
        throw new Error('x')
      }),
      signOut: vi.fn(async () => {
        throw new Error('offline')
      }),
      dispose: undefined,
    })
    await expect(disposeAdultClient({ auth } as never)).resolves.toBeUndefined()
  })
})

describe('verifyEmailCode', () => {
  it('returns a session whose client stays raw inside reactive state and whose end runs once', async () => {
    const { auth } = fakeAuth()
    const client = { auth }
    const session = await verifyEmailCode(client as never, 'sam@roost.test', '123456')
    const state = reactive({ adult: session })
    expect(isReactive(state.adult)).toBe(true)
    expect(isReactive(state.adult.client)).toBe(false)

    await Promise.all([session.end(), session.end()])
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })
})
