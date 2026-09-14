/**
 * Weather on the display (spec §5.6). The household's forecast arrives with the snapshot (`household_weather`,
 * kept current through Realtime); when it is older than 30 minutes the display asks the `weather` Edge Function to
 * refresh it, at most once every 10 minutes. Weather that is missing or more than 3 hours old is hidden (§13).
 */
import { isDemo } from './householdSource'
import type { HouseholdWeather } from './snapshot'
import type { RoostClient } from './supabase'

/** The server's cache lifetime: older weather is worth a refresh request. */
export const WEATHER_STALE_MS = 30 * 60_000
/** A display asks for a refresh at most this often (per household), whether or not the last request worked. */
export const WEATHER_REFRESH_INTERVAL_MS = 10 * 60_000
/** Past this age "current" temperature is misleading, so the header hides the weather. */
export const WEATHER_MAX_AGE_MS = 3 * 60 * 60_000

const ageMs = (weather: HouseholdWeather, now: Date): number => now.getTime() - Date.parse(weather.fetchedAt)

export function weatherNeedsRefresh(weather: HouseholdWeather | null | undefined, now: Date): boolean {
  return !weather || ageMs(weather, now) > WEATHER_STALE_MS
}

export function weatherToShow(weather: HouseholdWeather | null | undefined, now: Date): HouseholdWeather | null {
  if (!weather || ageMs(weather, now) > WEATHER_MAX_AGE_MS) return null
  return weather
}

export interface WeatherApi {
  /** Asks the server to refresh the household's cached forecast; the new row arrives with the snapshot. */
  refresh(householdId: string): Promise<void>
}

export function createWeatherApi(client: RoostClient): WeatherApi {
  return {
    async refresh(householdId) {
      const { error } = await client.functions.invoke('weather', { body: { householdId } })
      if (error) throw error instanceof Error ? error : new Error(String(error))
    },
  }
}

export interface WeatherRefresher {
  /** Requests a refresh when `weather` is stale and none was requested for this household in the last 10 minutes.
   *  Resolves true when a refresh request succeeded. Never rejects. */
  maybeRefresh(householdId: string, weather: HouseholdWeather | null | undefined, now: Date): Promise<boolean>
}

export function createWeatherRefresher(api: WeatherApi): WeatherRefresher {
  const lastRequestAt = new Map<string, number>()
  let inFlight = false
  return {
    async maybeRefresh(householdId, weather, now) {
      if (inFlight || !weatherNeedsRefresh(weather, now)) return false
      const last = lastRequestAt.get(householdId)
      if (last !== undefined && now.getTime() - last < WEATHER_REFRESH_INTERVAL_MS) return false
      lastRequestAt.set(householdId, now.getTime())
      inFlight = true
      try {
        await api.refresh(householdId)
        return true
      } catch (e) {
        console.warn('Weather refresh failed', e)
        return false
      } finally {
        inFlight = false
      }
    },
  }
}

/** The demo has sample weather and no server. */
const demoWeatherApi: WeatherApi = { async refresh() {} }

/** The display's API, on the display's own client (loaded lazily so the Supabase client isn't built in tests). */
export async function loadWeatherApi(): Promise<WeatherApi> {
  if (isDemo) return demoWeatherApi
  const { displayClient } = await import('./supabase')
  return createWeatherApi(displayClient)
}
