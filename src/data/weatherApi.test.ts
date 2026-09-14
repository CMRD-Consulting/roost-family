import { describe, expect, it, vi } from 'vitest'
import type { HouseholdWeather } from './snapshot'
import type { RoostClient } from './supabase'
import {
  WEATHER_MAX_AGE_MS,
  WEATHER_REFRESH_INTERVAL_MS,
  WEATHER_STALE_MS,
  createWeatherApi,
  createWeatherRefresher,
  weatherNeedsRefresh,
  weatherToShow,
  type WeatherApi,
} from './weatherApi'

const NOW = new Date('2026-09-14T19:00:00Z')
const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const weather = (over: Partial<HouseholdWeather> = {}): HouseholdWeather => ({
  fetchedAt: ago(5 * 60_000),
  currentTempF: 74,
  highF: 78,
  lowF: 61,
  precipChance: 20,
  summary: 'Partly Sunny',
  icon: 'partly',
  ...over,
})

describe('weatherNeedsRefresh', () => {
  it('is true with no weather, or weather older than 30 minutes', () => {
    expect(weatherNeedsRefresh(null, NOW)).toBe(true)
    expect(weatherNeedsRefresh(undefined, NOW)).toBe(true)
    expect(weatherNeedsRefresh(weather({ fetchedAt: ago(WEATHER_STALE_MS + 1) }), NOW)).toBe(true)
  })

  it('is false for weather fetched within 30 minutes', () => {
    expect(weatherNeedsRefresh(weather({ fetchedAt: ago(WEATHER_STALE_MS - 1) }), NOW)).toBe(false)
  })
})

describe('weatherToShow', () => {
  it('shows weather up to 3 hours old', () => {
    const w = weather({ fetchedAt: ago(WEATHER_MAX_AGE_MS - 1) })
    expect(weatherToShow(w, NOW)).toBe(w)
  })

  it('hides missing or too-old weather (spec §13: weather unavailable → hide)', () => {
    expect(weatherToShow(null, NOW)).toBeNull()
    expect(weatherToShow(undefined, NOW)).toBeNull()
    expect(weatherToShow(weather({ fetchedAt: ago(WEATHER_MAX_AGE_MS + 1) }), NOW)).toBeNull()
  })
})

describe('createWeatherApi', () => {
  it('invokes the weather Edge Function with the household id', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'refreshed' }, error: null }))
    const api = createWeatherApi({ functions: { invoke } } as unknown as RoostClient)
    await api.refresh(HOUSEHOLD)
    expect(invoke).toHaveBeenCalledWith('weather', { body: { householdId: HOUSEHOLD } })
  })

  it('throws the function error', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error('Edge Function returned a non-2xx status code') }))
    const api = createWeatherApi({ functions: { invoke } } as unknown as RoostClient)
    await expect(api.refresh(HOUSEHOLD)).rejects.toThrow('non-2xx')
  })
})

describe('createWeatherRefresher', () => {
  function setup() {
    const api: WeatherApi = { refresh: vi.fn(async () => {}) }
    return { api, refresher: createWeatherRefresher(api) }
  }

  it('asks for a refresh when the weather is stale, then not again within 10 minutes', async () => {
    const { api, refresher } = setup()
    expect(await refresher.maybeRefresh(HOUSEHOLD, null, NOW)).toBe(true)
    expect(await refresher.maybeRefresh(HOUSEHOLD, null, new Date(NOW.getTime() + WEATHER_REFRESH_INTERVAL_MS - 1))).toBe(false)
    expect(await refresher.maybeRefresh(HOUSEHOLD, null, new Date(NOW.getTime() + WEATHER_REFRESH_INTERVAL_MS))).toBe(true)
    expect(api.refresh).toHaveBeenCalledTimes(2)
    expect(api.refresh).toHaveBeenCalledWith(HOUSEHOLD)
  })

  it('does nothing while the weather is fresh', async () => {
    const { api, refresher } = setup()
    expect(await refresher.maybeRefresh(HOUSEHOLD, weather(), NOW)).toBe(false)
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('throttles per household, so switching households can refresh at once', async () => {
    const { api, refresher } = setup()
    await refresher.maybeRefresh(HOUSEHOLD, null, NOW)
    expect(await refresher.maybeRefresh('bbbbbbbb-0000-0000-0000-000000000001', null, NOW)).toBe(true)
    expect(api.refresh).toHaveBeenCalledTimes(2)
  })

  it('does not overlap requests, and a failure still counts toward the throttle', async () => {
    let fail!: (e: Error) => void
    const api: WeatherApi = { refresh: vi.fn(() => new Promise<void>((_, reject) => (fail = reject))) }
    const refresher = createWeatherRefresher(api)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = refresher.maybeRefresh(HOUSEHOLD, null, NOW)
    expect(await refresher.maybeRefresh(HOUSEHOLD, null, new Date(NOW.getTime() + WEATHER_REFRESH_INTERVAL_MS))).toBe(false)
    fail(new Error('offline'))
    expect(await first).toBe(false)
    expect(await refresher.maybeRefresh(HOUSEHOLD, null, new Date(NOW.getTime() + 60_000))).toBe(false)
    expect(api.refresh).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
