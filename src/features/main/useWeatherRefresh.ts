import { getCurrentScope, onScopeDispose, watch, type Ref } from 'vue'
import type { HouseholdWeather } from '@/data/snapshot'
import { createWeatherRefresher, loadWeatherApi, type WeatherApi, type WeatherRefresher } from '@/data/weatherApi'

export interface WeatherRefreshOptions {
  householdId: () => string | null
  weather: () => HouseholdWeather | null | undefined
  online: () => boolean
  /** The screen's ticking clock; each tick re-checks staleness. */
  now: Ref<Date>
  /** Called after a successful refresh request (e.g. to reload when Realtime can't deliver the new row). */
  onRefreshed: () => void
  loadApi?: () => Promise<WeatherApi>
}

/** One refresher per display (not per mount), so remounting the main screen doesn't reset the 10-minute limit. */
let shared: Promise<WeatherRefresher> | null = null

/** Keeps the household's cached weather fresh while the calling screen is shown (spec §5.6). */
export function useWeatherRefresh(options: WeatherRefreshOptions): void {
  const refresher = options.loadApi
    ? options.loadApi().then(createWeatherRefresher)
    : (shared ??= loadWeatherApi()
        .then(createWeatherRefresher)
        .catch((e: unknown) => {
          shared = null // e.g. a failed chunk load: try again on the next mount
          throw e
        }))

  let active = true
  watch(
    [options.householdId, options.weather, options.online, options.now],
    async ([householdId, weather, online]) => {
      if (!householdId || !online) return
      try {
        if (await (await refresher).maybeRefresh(householdId, weather, new Date(options.now.value)) && active) {
          options.onRefreshed()
        }
      } catch (e) {
        console.warn('Weather refresh unavailable', e)
      }
    },
    { immediate: true },
  )
  // The watcher stops with the component; a request already on its way must not call back afterwards.
  if (getCurrentScope()) onScopeDispose(() => (active = false))
}
