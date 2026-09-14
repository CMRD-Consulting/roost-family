import { describe, expect, it, vi } from 'vitest'
import { createWeatherHandler, type WeatherHandlerDeps } from './handler.ts'
import type { RefreshResult } from './refresh.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const URL_ = 'http://127.0.0.1:55321/functions/v1/weather'

const WEATHER = {
  fetchedAt: '2026-09-14T17:30:00.000Z',
  currentTempF: 74,
  highF: 78,
  lowF: 61,
  precipChance: 20,
  summary: 'Partly Sunny',
  icon: 'partly' as const,
  error: null,
}

function deps(overrides: Partial<WeatherHandlerDeps> = {}): WeatherHandlerDeps {
  return {
    isMember: vi.fn(async () => true),
    refresh: vi.fn(async (): Promise<RefreshResult> => ({ status: 'refreshed', stale: false, weather: WEATHER })),
    now: () => new Date('2026-09-14T17:30:00Z'),
    ...overrides,
  }
}

const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer jwt' }) =>
  new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('weather handler', () => {
  it('answers CORS preflight', async () => {
    const res = await createWeatherHandler(deps())(new Request(URL_, { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-client-info, apikey, content-type')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
  })

  it('rejects other methods', async () => {
    const res = await createWeatherHandler(deps())(new Request(URL_, { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('requires an Authorization header', async () => {
    const d = deps()
    const res = await createWeatherHandler(d)(post({ householdId: HOUSEHOLD }, {}))
    expect(res.status).toBe(401)
    expect(d.isMember).not.toHaveBeenCalled()
  })

  it('rejects a missing or malformed household id', async () => {
    const d = deps()
    for (const body of [{}, { householdId: 'nope' }, { householdId: 42 }]) {
      const res = await createWeatherHandler(d)(post(body))
      expect(res.status).toBe(400)
    }
    const bad = new Request(URL_, { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: '{not json' })
    expect((await createWeatherHandler(d)(bad)).status).toBe(400)
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('refuses callers who are not members of the household', async () => {
    const d = deps({ isMember: vi.fn(async () => false) })
    const res = await createWeatherHandler(d)(post({ householdId: HOUSEHOLD }))
    expect(res.status).toBe(403)
    expect(d.isMember).toHaveBeenCalledWith('Bearer jwt', HOUSEHOLD)
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('returns the refreshed weather with CORS headers', async () => {
    const d = deps()
    const res = await createWeatherHandler(d)(post({ householdId: HOUSEHOLD }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual({ status: 'refreshed', stale: false, weather: WEATHER })
    expect(d.refresh).toHaveBeenCalledWith(HOUSEHOLD, new Date('2026-09-14T17:30:00Z'))
  })

  it('returns 200 with stale: true when the provider failed', async () => {
    const d = deps({ refresh: vi.fn(async (): Promise<RefreshResult> => ({ status: 'failed', stale: true, weather: WEATHER })) })
    const res = await createWeatherHandler(d)(post({ householdId: HOUSEHOLD }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'failed', stale: true })
  })

  it('returns weather: null without a location, and 404 for an unknown household', async () => {
    let res = await createWeatherHandler(deps({ refresh: vi.fn(async (): Promise<RefreshResult> => ({ status: 'no_location' })) }))(
      post({ householdId: HOUSEHOLD }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'no_location', stale: false, weather: null })
    res = await createWeatherHandler(deps({ refresh: vi.fn(async (): Promise<RefreshResult> => ({ status: 'not_found' })) }))(
      post({ householdId: HOUSEHOLD }),
    )
    expect(res.status).toBe(404)
  })

  it('hides internal errors behind a generic 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({
      isMember: vi.fn(async () => {
        throw new Error('secret db detail')
      }),
    })
    const res = await createWeatherHandler(d)(post({ householdId: HOUSEHOLD }))
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret')
    log.mockRestore()
  })
})
