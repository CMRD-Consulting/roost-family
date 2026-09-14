/**
 * Weather cache refresh (spec §5.6), independent of Deno and Supabase so Vitest can exercise it.
 *
 * The cached row is returned while it is younger than 30 minutes. Otherwise the provider is asked for a fresh
 * summary (reusing the cached /points lookup when there is one), and the row is saved. A failed refresh records
 * `error` and keeps the last good values, so displays keep showing them (they hide weather that is too old).
 */
import {
  parsePoints,
  summarize,
  type NwsForecastResponse,
  type NwsForecastUrls,
  type NwsPointsResponse,
  type WeatherIcon,
  type WeatherSummary,
} from '../_shared/nws.ts'

export const WEATHER_CACHE_MS = 30 * 60_000
const SUMMARY_MAX = 200
const ERROR_MAX = 500

export interface WeatherLocation {
  lat: number
  lon: number
}

/** A forecast source. NWS today; another provider can replace it for households outside the US. */
export interface WeatherProvider {
  /** Resolves the location's forecast endpoints (cached with the row). */
  lookup(location: WeatherLocation): Promise<NwsForecastUrls>
  forecast(endpoints: NwsForecastUrls, now: Date, timeZone: string): Promise<WeatherSummary>
}

/** A non-2xx response from the provider. */
export class WeatherHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`NWS request failed (${status}): ${url}`)
    this.name = 'WeatherHttpError'
  }
}

/** GETs JSON; throws WeatherHttpError for a non-2xx response and passes network/timeout errors through. */
export type FetchJson = (url: string) => Promise<unknown>

/** NWS asks for at most 4 decimal places (it redirects otherwise); trailing zeros are dropped. */
const coordinate = (value: number): string => String(Number(value.toFixed(4)))

export function createNwsProvider(fetchJson: FetchJson): WeatherProvider {
  return {
    async lookup({ lat, lon }) {
      const json = await fetchJson(`https://api.weather.gov/points/${coordinate(lat)},${coordinate(lon)}`)
      return parsePoints(json as NwsPointsResponse)
    },
    async forecast({ forecastUrl, forecastHourlyUrl }, now, timeZone) {
      const [daily, hourly] = await Promise.all([fetchJson(forecastUrl), fetchJson(forecastHourlyUrl)])
      return summarize(daily as NwsForecastResponse, hourly as NwsForecastResponse, now, timeZone)
    },
  }
}

/** A `public.household_weather` row as the function reads and writes it. */
export interface WeatherRow {
  household_id: string
  fetched_at: string | null
  current_temp_f: number | null
  high_f: number | null
  low_f: number | null
  precip_chance: number | null
  summary: string | null
  icon: WeatherIcon | null
  error: string | null
  points_forecast_url: string | null
  points_hourly_url: string | null
}

export interface WeatherStore {
  /** The live household's time zone and location, or null when it doesn't exist (or was deleted). */
  household(householdId: string): Promise<{ timeZone: string; lat: number | null; lon: number | null } | null>
  cached(householdId: string): Promise<WeatherRow | null>
  /** Upserts by household_id. */
  save(row: WeatherRow): Promise<void>
}

/** What callers see: the row without the provider's internal endpoints. */
export interface PublicWeather {
  fetchedAt: string | null
  currentTempF: number | null
  highF: number | null
  lowF: number | null
  precipChance: number | null
  summary: string | null
  icon: WeatherIcon | null
  error: string | null
}

export type RefreshResult =
  | { status: 'not_found' }
  | { status: 'no_location' }
  | { status: 'cached' | 'refreshed' | 'failed'; stale: boolean; weather: PublicWeather }

function toPublic(row: WeatherRow): PublicWeather {
  return {
    fetchedAt: row.fetched_at,
    currentTempF: row.current_temp_f,
    highF: row.high_f,
    lowF: row.low_f,
    precipChance: row.precip_chance,
    summary: row.summary,
    icon: row.icon,
    error: row.error,
  }
}

function emptyRow(householdId: string): WeatherRow {
  return {
    household_id: householdId,
    fetched_at: null,
    current_temp_f: null,
    high_f: null,
    low_f: null,
    precip_chance: null,
    summary: null,
    icon: null,
    error: null,
    points_forecast_url: null,
    points_hourly_url: null,
  }
}

export async function refreshWeather(
  store: WeatherStore,
  provider: WeatherProvider,
  householdId: string,
  now: Date,
): Promise<RefreshResult> {
  const household = await store.household(householdId)
  if (!household) return { status: 'not_found' }
  if (household.lat === null || household.lon === null) return { status: 'no_location' }
  const location = { lat: household.lat, lon: household.lon }

  const cached = await store.cached(householdId)
  if (cached?.fetched_at && now.getTime() - Date.parse(cached.fetched_at) < WEATHER_CACHE_MS) {
    return { status: 'cached', stale: false, weather: toPublic(cached) }
  }

  try {
    const cachedEndpoints =
      cached?.points_forecast_url && cached.points_hourly_url
        ? { forecastUrl: cached.points_forecast_url, forecastHourlyUrl: cached.points_hourly_url }
        : null
    let endpoints = cachedEndpoints ?? (await provider.lookup(location))
    let summary: WeatherSummary
    try {
      summary = await provider.forecast(endpoints, now, household.timeZone)
    } catch (e) {
      // NWS grid assignments occasionally change; cached endpoints that no longer exist are looked up again.
      if (!cachedEndpoints || !(e instanceof WeatherHttpError && e.status === 404)) throw e
      endpoints = await provider.lookup(location)
      summary = await provider.forecast(endpoints, now, household.timeZone)
    }

    const row: WeatherRow = {
      household_id: householdId,
      fetched_at: now.toISOString(),
      current_temp_f: summary.currentTempF,
      high_f: summary.highF,
      low_f: summary.lowF,
      precip_chance: summary.precipChance,
      summary: summary.summary.slice(0, SUMMARY_MAX),
      icon: summary.icon,
      error: null,
      points_forecast_url: endpoints.forecastUrl,
      points_hourly_url: endpoints.forecastHourlyUrl,
    }
    await store.save(row)
    return { status: 'refreshed', stale: false, weather: toPublic(row) }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX)
    const row: WeatherRow = { ...(cached ?? emptyRow(householdId)), error: message }
    await store.save(row)
    return { status: 'failed', stale: true, weather: toPublic(row) }
  }
}
