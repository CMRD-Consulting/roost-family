import { describe, expect, it, vi } from 'vitest'
import { createSweepHandler, type SweepHandlerDeps } from './handler.ts'

const URL_ = 'http://127.0.0.1:55321/functions/v1/storage-sweep'
const REPORT = {
  scanned: 2, kept: 1, removedOrphans: 1, removedGoneHousehold: 0, skipped: 0, failed: 0,
  exports: { scanned: 1, kept: 0, removedExpired: 1, removedUnrecorded: 0, skipped: 0, failed: 0 },
}

function deps(overrides: Partial<SweepHandlerDeps> = {}): SweepHandlerDeps & Record<'sweep', ReturnType<typeof vi.fn>> {
  return {
    serviceKeys: ['service-key'],
    sweep: vi.fn(async () => REPORT),
    now: () => new Date('2026-09-14T19:00:00Z'),
    ...overrides,
  } as never
}

const post = (body: string | null, authorization: string | null = 'Bearer service-key') =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body,
  })

describe('storage-sweep handler', () => {
  it('rejects callers without the service key, before doing anything', async () => {
    const d = deps()
    for (const auth of [null, 'Bearer anon-key', 'Bearer eyJhbGciOi.user.jwt', 'service-key']) {
      const res = await createSweepHandler(d)(post('{}', auth))
      expect(res.status).toBe(401)
    }
    expect(d.sweep).not.toHaveBeenCalled()
  })

  it('rejects methods other than POST', async () => {
    const res = await createSweepHandler(deps())(new Request(URL_, { method: 'GET', headers: { Authorization: 'Bearer service-key' } }))
    expect(res.status).toBe(405)
  })

  it('sweeps with the default 60-minute age when there is no body, and returns the counts', async () => {
    const d = deps()
    const res = await createSweepHandler(d)(post(null))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(REPORT)
    expect(d.sweep).toHaveBeenCalledWith({ minAgeMinutes: 60 }, new Date('2026-09-14T19:00:00Z'))
  })

  it('takes minAgeMinutes from the body', async () => {
    const d = deps()
    await createSweepHandler(d)(post('{"minAgeMinutes":0}'))
    expect(d.sweep).toHaveBeenCalledWith({ minAgeMinutes: 0 }, expect.any(Date))
  })

  it('rejects a bad body', async () => {
    const d = deps()
    expect((await createSweepHandler(d)(post('{nope'))).status).toBe(400)
    expect((await createSweepHandler(d)(post('{"minAgeMinutes":-5}'))).status).toBe(400)
    expect(d.sweep).not.toHaveBeenCalled()
  })

  it('reports a failed sweep as a 500 without details', async () => {
    const d = deps({ sweep: vi.fn(async () => Promise.reject(new Error('secret internals'))) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createSweepHandler(d)(post('{}'))
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret internals')
  })
})
