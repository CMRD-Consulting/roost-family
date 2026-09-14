import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { resetSettingsApiLoaderForTests } from './settingsApiLoader'
import { useSettingsSave } from './useSettingsSave'

const api = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})

const AUTH = { membershipId: 'bbbbbbbb-0000-0000-0000-000000000001', pin: '1234' }

function mountSave() {
  let handle!: ReturnType<typeof useSettingsSave>
  const w = mount(defineComponent({
    setup() {
      handle = useSettingsSave()
      return () => h('p')
    },
  }))
  return { w, save: handle }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  const settingsApi = { settingsVerify: vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' }) } as unknown as SettingsApi
  api.current = settingsApi
  const session = useSettingsSessionStore()
  session.init(settingsApi)
  await session.enter(AUTH.membershipId, AUTH.pin)
  useHouseholdStore().online = true
})

afterEach(() => {
  resetSettingsApiLoaderForTests()
  vi.restoreAllMocks()
})

describe('useSettingsSave', () => {
  it('reloads the household after a successful save, without waiting for it to show Saved', async () => {
    const store = useHouseholdStore()
    const reload = vi.spyOn(store, 'reload').mockReturnValue(new Promise(() => {}))
    const { w, save } = mountSave()

    const action = vi.fn().mockResolvedValue(undefined)
    await expect(save.save(action)).resolves.toBe(true)

    expect(action).toHaveBeenCalledWith(api.current, AUTH)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(save.saved.value).toBe(true)
    w.unmount()
  })

  it('does not reload after a failed save', async () => {
    const reload = vi.spyOn(useHouseholdStore(), 'reload').mockResolvedValue(undefined)
    const { w, save } = mountSave()

    await expect(save.save(() => Promise.reject(new SettingsError('bad', 'invalid')))).resolves.toBe(false)
    await flushPromises()

    expect(reload).not.toHaveBeenCalled()
    expect(save.error.value).toBe('Bad.')
    w.unmount()
  })

  it('a failing reload does not turn the save into an error', async () => {
    vi.spyOn(useHouseholdStore(), 'reload').mockRejectedValue(new Error('offline'))
    const { w, save } = mountSave()

    await expect(save.save(() => Promise.resolve())).resolves.toBe(true)
    await flushPromises()

    expect(save.error.value).toBeNull()
    expect(save.saved.value).toBe(true)
    w.unmount()
  })
})
