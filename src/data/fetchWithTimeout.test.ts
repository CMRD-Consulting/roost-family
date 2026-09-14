import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFetchWithTimeout } from './fetchWithTimeout'

afterEach(() => vi.useRealTimers())

/** A fetch that never resolves on its own but rejects when its signal aborts. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
    })
}

describe('createFetchWithTimeout', () => {
  it('rejects a stalled request after the timeout', async () => {
    vi.useFakeTimers()
    const f = createFetchWithTimeout(1000, hangingFetch())
    const pending = f('https://example.test')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('passes through a response that arrives in time', async () => {
    const response = new Response('ok')
    const base = vi.fn(async () => response)
    const f = createFetchWithTimeout(1000, base)
    await expect(f('https://example.test', { method: 'POST' })).resolves.toBe(response)
    expect(base).toHaveBeenCalledWith('https://example.test', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }))
  })

  it('honors an abort from the caller', async () => {
    const caller = new AbortController()
    const f = createFetchWithTimeout(60_000, hangingFetch())
    const pending = f('https://example.test', { signal: caller.signal })
    caller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
  })
})
