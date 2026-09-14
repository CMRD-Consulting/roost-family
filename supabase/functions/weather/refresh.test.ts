import { describe, expect, it, vi } from 'vitest'
import type { NwsForecastPeriod, NwsForecastResponse } from '../_shared/nws.ts'
import {
  WEATHER_ATTEMPT_MS,
  WEATHER_CACHE_MS,
  WeatherHttpError,
  createNwsProvider,
  refreshWeather,
  type WeatherProvider,
  type WeatherRow,
  type WeatherStore,
} from './refresh.ts'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const NOW = new Date('2026-09-14T17:30:00Z') // 13:30 in New York
const TZ = 'America/New_York'

const period = (p: Partial<NwsForecastPeriod>): NwsForecastPeriod => ({
  number: 1,
  name: '',
  startTime: '2026-09-14T13:00:00-04:00',
  endTime: '2026-09-14T14:00:00-04:00',
  isDaytime: true,
  temperature: 70,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Sunny',
  ...p,
})

const DAILY: NwsForecastResponse = {
  properties: {
    periods: [
      period({ isDaytime: true, startTime: '2026-09-14T06:00:00-04:00', endTime: '2026-09-14T18:00:00-04:00', temperature: 78 }),
      period({ isDaytime: false, startTime: '2026-09-14T18:00:00-04:00', endTime: '2026-09-15T06:00:00-04:00', temperature: 61 }),
    ],
  },
}
const HOURLY: NwsForecastResponse = {
  properties: {
    periods: [
      period({ temperature: 74, shortForecast: 'Partly Sunny', probabilityOfPrecipitation: { value: 10 } }),
      period({ startTime: '2026-09-14T14:00:00-04:00', endTime: '2026-09-14T15:00:00-04:00', probabilityOfPrecipitation: { value: 20 } }),
    ],
  },
}

const POINTS_URL = 'https://api.weather.gov/points/35.23,-80.84'
const FORECAST_URL = 'https://api.weather.gov/gridpoints/GSP/119,65/forecast'
const HOURLY_URL = 'https://api.weather.gov/gridpoints/GSP/119,65/forecast/hourly'

function row(overrides: Partial<WeatherRow> = {}): WeatherRow {
  return {
    household_id: HOUSEHOLD,
    fetched_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    current_temp_f: 70,
    high_f: 75,
    low_f: 60,
    precip_chance: 0,
    summary: 'Cloudy',
    icon: 'cloud',
    error: null,
    points_forecast_url: FORECAST_URL,
    points_hourly_url: HOURLY_URL,
    attempted_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    ...overrides,
  }
}

function fakeStore(
  cached: WeatherRow | null,
  household: Awaited<ReturnType<WeatherStore['household']>> = { timeZone: TZ, lat: 35.23, lon: -80.84 },
  claim = true,
) {
  const saved: WeatherRow[] = []
  const store: WeatherStore = {
    household: vi.fn(async () => household),
    cached: vi.fn(async () => cached),
    claimAttempt: vi.fn(async () => claim),
    save: vi.fn(async (r: WeatherRow) => {
      saved.push(r)
    }),
  }
  return { store, saved }
}

function fakeFetch(responses: Record<string, unknown | WeatherHttpError>) {
  return vi.fn(async (url: string) => {
    if (!(url in responses)) throw new Error(`unexpected request ${url}`)
    const r = responses[url]
    if (r instanceof Error) throw r
    return r
  })
}

describe('createNwsProvider', () => {
  it('looks up the forecast URLs for a location with 4-decimal coordinates', async () => {
    const fetchJson = fakeFetch({
      'https://api.weather.gov/points/35.2271,-80.8431': { properties: { forecast: FORECAST_URL, forecastHourly: HOURLY_URL } },
    })
    const provider = createNwsProvider(fetchJson)
    expect(await provider.lookup({ lat: 35.22709, lon: -80.84313 })).toEqual({ forecastUrl: FORECAST_URL, forecastHourlyUrl: HOURLY_URL })
  })

  it('summarizes the daily and hourly forecasts', async () => {
    const provider = createNwsProvider(fakeFetch({ [FORECAST_URL]: DAILY, [HOURLY_URL]: HOURLY }))
    expect(await provider.forecast({ forecastUrl: FORECAST_URL, forecastHourlyUrl: HOURLY_URL }, NOW, TZ)).toEqual({
      currentTempF: 74,
      highF: 78,
      lowF: 61,
      precipChance: 20,
      summary: 'Partly Sunny',
      icon: 'partly',
    })
  })
})

describe('refreshWeather', () => {
  it('returns not_found for an unknown household and no_location without coordinates, without fetching', async () => {
    const fetchJson = fakeFetch({})
    const provider = createNwsProvider(fetchJson)
    expect(await refreshWeather(fakeStore(null, null).store, provider, HOUSEHOLD, NOW)).toEqual({ status: 'not_found' })
    const { store, saved } = fakeStore(null, { timeZone: TZ, lat: null, lon: -80.84 })
    expect(await refreshWeather(store, provider, HOUSEHOLD, NOW)).toEqual({ status: 'no_location' })
    expect(fetchJson).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  it('returns the cached row while it is younger than 30 minutes', async () => {
    const fetchJson = fakeFetch({})
    const { store, saved } = fakeStore(row())
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(result).toEqual({
      status: 'cached',
      stale: false,
      weather: {
        fetchedAt: row().fetched_at,
        currentTempF: 70,
        highF: 75,
        lowF: 60,
        precipChance: 0,
        summary: 'Cloudy',
        icon: 'cloud',
        error: null,
      },
    })
    expect(fetchJson).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  it('looks up points, fetches both forecasts and saves the row when nothing is cached', async () => {
    const fetchJson = fakeFetch({
      [POINTS_URL]: { properties: { forecast: FORECAST_URL, forecastHourly: HOURLY_URL } },
      [FORECAST_URL]: DAILY,
      [HOURLY_URL]: HOURLY,
    })
    const { store, saved } = fakeStore(null)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(saved).toEqual([
      {
        household_id: HOUSEHOLD,
        fetched_at: NOW.toISOString(),
        current_temp_f: 74,
        high_f: 78,
        low_f: 61,
        precip_chance: 20,
        summary: 'Partly Sunny',
        icon: 'partly',
        error: null,
        points_forecast_url: FORECAST_URL,
        points_hourly_url: HOURLY_URL,
        attempted_at: NOW.toISOString(),
      },
    ])
    expect(result).toMatchObject({ status: 'refreshed', stale: false, weather: { currentTempF: 74, fetchedAt: NOW.toISOString() } })
  })

  it('makes no NWS request within 5 minutes of the last attempt that succeeded, returning the cached values', async () => {
    const fetchJson = fakeFetch({})
    const attempted = row({
      fetched_at: new Date(NOW.getTime() - WEATHER_CACHE_MS - 60_000).toISOString(),
      attempted_at: new Date(NOW.getTime() - WEATHER_ATTEMPT_MS + 1000).toISOString(),
    })
    const { store, saved } = fakeStore(attempted)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(store.claimAttempt).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    expect(result).toMatchObject({ status: 'cached', stale: true, weather: { currentTempF: 70, fetchedAt: attempted.fetched_at } })
  })

  it('makes no NWS request within 5 minutes of the last attempt that failed, returning the last good values and error', async () => {
    const fetchJson = fakeFetch({})
    const failed = row({
      fetched_at: new Date(NOW.getTime() - 3 * WEATHER_CACHE_MS).toISOString(),
      attempted_at: new Date(NOW.getTime() - 60_000).toISOString(),
      error: 'NWS request failed (503)',
    })
    const { store } = fakeStore(failed)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'cached', stale: true, weather: { currentTempF: 70, error: 'NWS request failed (503)' } })
  })

  it('tries again once 5 minutes have passed since the last attempt', async () => {
    const fetchJson = fakeFetch({ [FORECAST_URL]: DAILY, [HOURLY_URL]: HOURLY })
    const { store } = fakeStore(
      row({ fetched_at: null, attempted_at: new Date(NOW.getTime() - WEATHER_ATTEMPT_MS).toISOString(), error: 'timeout' }),
    )
    expect((await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)).status).toBe('refreshed')
    expect(store.claimAttempt).toHaveBeenCalledWith(HOUSEHOLD)
  })

  it('makes no NWS request when another request claimed the attempt first (concurrent displays)', async () => {
    const fetchJson = fakeFetch({})
    const stale = row({ fetched_at: new Date(NOW.getTime() - 2 * WEATHER_CACHE_MS).toISOString(), attempted_at: null })
    const { store, saved } = fakeStore(stale, undefined, false)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(saved).toEqual([])
    expect(result).toMatchObject({ status: 'cached', stale: true, weather: { currentTempF: 70 } })

    const { store: empty } = fakeStore(null, undefined, false)
    expect(await refreshWeather(empty, createNwsProvider(fetchJson), HOUSEHOLD, NOW)).toMatchObject({
      status: 'cached',
      stale: true,
      weather: { currentTempF: null, fetchedAt: null },
    })
  })

  it('reuses cached points URLs for a stale row (two requests, not three)', async () => {
    const fetchJson = fakeFetch({ [FORECAST_URL]: DAILY, [HOURLY_URL]: HOURLY })
    const stale = row({ fetched_at: new Date(NOW.getTime() - WEATHER_CACHE_MS - 1).toISOString() })
    const { store, saved } = fakeStore(stale)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(saved[0]).toMatchObject({ current_temp_f: 74, error: null })
    expect(result.status).toBe('refreshed')
  })

  it('refreshes a row that has never succeeded', async () => {
    const fetchJson = fakeFetch({ [FORECAST_URL]: DAILY, [HOURLY_URL]: HOURLY })
    const { store } = fakeStore(row({ fetched_at: null, current_temp_f: null, error: 'timeout', attempted_at: null }))
    expect((await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)).status).toBe('refreshed')
  })

  it('looks the points up again when cached forecast URLs return 404', async () => {
    const NEW_FORECAST = 'https://api.weather.gov/gridpoints/GSP/120,65/forecast'
    const NEW_HOURLY = 'https://api.weather.gov/gridpoints/GSP/120,65/forecast/hourly'
    const fetchJson = fakeFetch({
      [FORECAST_URL]: new WeatherHttpError(404, FORECAST_URL),
      [HOURLY_URL]: new WeatherHttpError(404, HOURLY_URL),
      [POINTS_URL]: { properties: { forecast: NEW_FORECAST, forecastHourly: NEW_HOURLY } },
      [NEW_FORECAST]: DAILY,
      [NEW_HOURLY]: HOURLY,
    })
    const { store, saved } = fakeStore(row({ fetched_at: null, attempted_at: null }))
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(result.status).toBe('refreshed')
    expect(saved[0]).toMatchObject({ points_forecast_url: NEW_FORECAST, points_hourly_url: NEW_HOURLY, error: null })
  })

  it('on failure keeps the last good values, records the error and reports stale', async () => {
    const fetchJson = fakeFetch({ [FORECAST_URL]: new WeatherHttpError(503, FORECAST_URL), [HOURLY_URL]: HOURLY })
    const old = row({ fetched_at: new Date(NOW.getTime() - 2 * WEATHER_CACHE_MS).toISOString() })
    const { store, saved } = fakeStore(old)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(saved).toEqual([{ ...old, error: `NWS request failed (503): ${FORECAST_URL}`, attempted_at: NOW.toISOString() }])
    expect(result).toMatchObject({
      status: 'failed',
      stale: true,
      weather: { currentTempF: 70, fetchedAt: old.fetched_at, error: `NWS request failed (503): ${FORECAST_URL}` },
    })
  })

  it('on a first-time failure saves an empty row with the error', async () => {
    const fetchJson = fakeFetch({ [POINTS_URL]: new Error('The signal has been aborted') })
    const { store, saved } = fakeStore(null)
    const result = await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(saved).toEqual([
      {
        household_id: HOUSEHOLD,
        fetched_at: null,
        current_temp_f: null,
        high_f: null,
        low_f: null,
        precip_chance: null,
        summary: null,
        icon: null,
        error: 'The signal has been aborted',
        points_forecast_url: null,
        points_hourly_url: null,
        attempted_at: NOW.toISOString(),
      },
    ])
    expect(result).toMatchObject({ status: 'failed', stale: true, weather: { currentTempF: null } })
  })

  it('bounds stored text lengths', async () => {
    const long = 'x'.repeat(900)
    const fetchJson = fakeFetch({ [POINTS_URL]: new Error(long) })
    const { store, saved } = fakeStore(null)
    await refreshWeather(store, createNwsProvider(fetchJson), HOUSEHOLD, NOW)
    expect(saved[0]!.error).toHaveLength(500)
  })

  it('throws when the cache cannot be read (the handler answers 500)', async () => {
    const provider: WeatherProvider = { lookup: vi.fn(), forecast: vi.fn() }
    const { store } = fakeStore(null)
    store.cached = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(refreshWeather(store, provider, HOUSEHOLD, NOW)).rejects.toThrow('db down')
  })
})
