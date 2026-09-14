import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import type { HouseholdWeather } from '@/data/snapshot'
import type { WeatherApi } from '@/data/weatherApi'
import { useWeatherRefresh } from './useWeatherRefresh'

const NOW = new Date('2026-09-14T19:00:00Z')
const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'

const fresh: HouseholdWeather = {
  fetchedAt: NOW.toISOString(),
  currentTempF: 74,
  highF: 78,
  lowF: 61,
  precipChance: 20,
  summary: 'Sunny',
  icon: 'sun',
}

function setup(initial: { weather?: HouseholdWeather | null; online?: boolean; householdId?: string | null } = {}) {
  const api: WeatherApi = { refresh: vi.fn(async () => {}) }
  const householdId = ref<string | null>(initial.householdId === undefined ? HOUSEHOLD : initial.householdId)
  const weather = ref<HouseholdWeather | null>(initial.weather ?? null)
  const online = ref(initial.online ?? true)
  const now = ref(NOW)
  const onRefreshed = vi.fn()
  const scope = effectScope()
  scope.run(() =>
    useWeatherRefresh({
      householdId: () => householdId.value,
      weather: () => weather.value,
      online: () => online.value,
      now,
      onRefreshed,
      loadApi: async () => api,
    }),
  )
  return { api, householdId, weather, online, now, onRefreshed, scope }
}

let active: ReturnType<typeof setup> | null = null
afterEach(() => active?.scope.stop())

describe('useWeatherRefresh', () => {
  it('asks for a refresh at once when there is no weather, then tells the caller', async () => {
    active = setup()
    await flushPromises()
    expect(active.api.refresh).toHaveBeenCalledWith(HOUSEHOLD)
    expect(active.onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('does not refresh fresh weather, but does once it goes stale on a later tick', async () => {
    active = setup({ weather: fresh })
    await flushPromises()
    expect(active.api.refresh).not.toHaveBeenCalled()
    active.now.value = new Date(NOW.getTime() + 31 * 60_000)
    await nextTick()
    await flushPromises()
    expect(active.api.refresh).toHaveBeenCalledTimes(1)
  })

  it('waits while offline or without a household', async () => {
    active = setup({ online: false })
    await flushPromises()
    expect(active.api.refresh).not.toHaveBeenCalled()
    active.online.value = true
    await nextTick()
    await flushPromises()
    expect(active.api.refresh).toHaveBeenCalledTimes(1)
    active.scope.stop()

    active = setup({ householdId: null })
    await flushPromises()
    expect(active.api.refresh).not.toHaveBeenCalled()
  })

  it('does not ask again within 10 minutes, even if the weather is still missing', async () => {
    active = setup()
    await flushPromises()
    active.now.value = new Date(NOW.getTime() + 5 * 60_000)
    await nextTick()
    await flushPromises()
    expect(active.api.refresh).toHaveBeenCalledTimes(1)
    active.now.value = new Date(NOW.getTime() + 10 * 60_000)
    await nextTick()
    await flushPromises()
    expect(active.api.refresh).toHaveBeenCalledTimes(2)
  })
})
