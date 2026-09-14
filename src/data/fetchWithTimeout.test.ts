import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createFetchWithTimeout } from './fetchWithTimeout'

afterEach(() => vi.useRealTimers())

const fakeTimers = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })

/** A fetch that never resolves on its own but rejects when its signal aborts. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
    })
}

/** A response whose headers arrive at once but whose body sends one chunk and then stalls (ignoring aborts). */
function stalledBodyResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'))
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('createFetchWithTimeout', () => {
  it('rejects a stalled request after the timeout with an AbortError that says it timed out', async () => {
    fakeTimers()
    const f = createFetchWithTimeout(1000, hangingFetch())
    const pending = f('https://example.test')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request timed out after 1000 ms' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('a supabase-js GET through it settles within one timeout instead of being retried by postgrest-js', async () => {
    fakeTimers()
    const base = vi.fn(hangingFetch())
    const client = createClient('https://example.supabase.test', 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createFetchWithTimeout(1000, base) },
    })

    let settled: { error: { message: string } | null } | null = null
    void client.from('children').select('id').then((r) => (settled = r))
    await vi.advanceTimersByTimeAsync(1100)

    expect(settled).not.toBeNull()
    expect(settled!.error?.message).toBe('AbortError: Request timed out after 1000 ms')
    // postgrest-js retries a failed GET up to 3 times with 1 s, 2 s and 4 s back-off unless the error is an AbortError.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('also times out a response whose body stalls after the headers arrive', async () => {
    fakeTimers()
    const f = createFetchWithTimeout(1000, async () => stalledBodyResponse())
    const response = await f('https://example.test')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const reading = response.text()
    const assertion = expect(reading).rejects.toMatchObject({ name: 'AbortError', message: 'Request timed out after 1000 ms' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('stops the timer once the body has been read', async () => {
    fakeTimers()
    let signal: AbortSignal | undefined
    const f = createFetchWithTimeout(1000, async (_input, init) => {
      signal = init?.signal ?? undefined
      return new Response('{"ok":true}', { status: 201 })
    })
    const response = await f('https://example.test')
    await expect(response.json()).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(signal?.aborted).toBe(false)
  })

  it('stops the timer at the headers when there is no body', async () => {
    fakeTimers()
    let signal: AbortSignal | undefined
    const f = createFetchWithTimeout(1000, async (_input, init) => {
      signal = init?.signal ?? undefined
      return new Response(null, { status: 204 })
    })
    const response = await f('https://example.test')
    expect(response.status).toBe(204)
    await vi.advanceTimersByTimeAsync(5000)
    expect(signal?.aborted).toBe(false)
  })

  it('passes a response that arrives in time through with its status and headers', async () => {
    const base = vi.fn(async () => new Response('ok', { status: 200, statusText: 'OK', headers: { 'X-Test': '1' } }))
    const f = createFetchWithTimeout(1000, base)
    const response = await f('https://example.test', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('OK')
    expect(response.headers.get('X-Test')).toBe('1')
    await expect(response.text()).resolves.toBe('ok')
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
