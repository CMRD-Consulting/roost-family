import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { resetDemoForTests } from '@/data/demo/demoHousehold'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import { resolveSettingsRoute } from '@/router'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import LegalPlaceholder from './LegalPlaceholder.vue'
import { resetSettingsApiLoaderForTests } from './settingsApiLoader'
import SettingsPinGate from './SettingsPinGate.vue'
import SettingsShell from './SettingsShell.vue'
import { useOpenSettings } from './useOpenSettings'

const api = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@/data/householdSource', async () => {
  const { demoSource } = await import('@/data/demo/demoSource')
  return {
    isDemo: true,
    DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' },
    selectSource: async () => demoSource,
    selectWriter: async () => (await import('@/data/demo/demoLogWriter')).createDemoLogWriter(),
    selectSettingsApi: async () => api.current,
  }
})
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const SAM_AUTH = { membershipId: SAM, pin: '1234' }

let pinia: Pinia
let router: Router

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function settle() {
  await vi.advanceTimersByTimeAsync(200)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function fakeApi(): SettingsApi & Record<'settingsVerify' | 'updateHouseholdSettings' | 'updateSitterInfo', ReturnType<typeof vi.fn>> {
  return {
    settingsVerify: vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' }),
    updateHouseholdSettings: vi.fn().mockResolvedValue(undefined),
    updateSitterInfo: vi.fn().mockResolvedValue(undefined),
  } as never
}

const Stub = (text: string) => defineComponent({ render: () => h('p', text) })
const App = defineComponent({ render: () => h(RouterView) })

async function mountApp(path: string, home = Stub('main screen')): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/home', component: home },
      { path: '/settings/:section?', component: SettingsShell, meta: { settingsSession: true } },
      { path: '/privacy', component: LegalPlaceholder, props: { title: 'Privacy policy' }, meta: { keepsSettingsSession: true } },
      { path: '/removed', component: Stub('removed') },
    ],
  })
  router.beforeEach((to) => resolveSettingsRoute(to, useSettingsSessionStore().info !== null))
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await settle()
  return wrapper
}

/** Opens a settings session for Sam against `settingsApi`, then shows /settings[/section]. */
async function openShell(settingsApi: SettingsApi, section = ''): Promise<VueWrapper> {
  api.current = settingsApi
  const session = useSettingsSessionStore()
  session.init(settingsApi)
  await session.enter(SAM, '1234')
  return mountApp(section ? `/settings/${section}` : '/settings')
}

function buttonByText(w: VueWrapper, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

function inputByLabel(w: VueWrapper, label: string) {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No label "${label}"`)
  const target = w.find(`#${CSS.escape(lab.attributes('for')!)}`)
  if (!target.exists()) throw new Error(`No field for "${label}"`)
  return target
}

beforeEach(() => {
  resetDemoForTests()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z')) // Monday 3:00 PM household time
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(async () => {
  document.body.innerHTML = ''
  setOnline(true)
  resetSettingsApiLoaderForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
  const { createOfflineQueue } = await import('@/data/offlineQueue')
  await createOfflineQueue().clear()
})

describe('SettingsPinGate', () => {
  const Host = defineComponent({
    setup() {
      const { openSettings } = useOpenSettings()
      return () => [h('button', { 'data-testid': 'gear', onClick: openSettings }, 'Settings'), h(SettingsPinGate)]
    },
  })

  async function mountGate(): Promise<VueWrapper> {
    api.current = (await import('@/data/demo/demoSettingsApi')).createDemoSettingsApi()
    useHouseholdStore().snapshot = buildDemoSnapshot(new Date())
    return mountApp('/home', Host)
  }

  async function enterPin(w: VueWrapper, who: string, pin: string) {
    await w.find('[data-testid="gear"]').trigger('click')
    await flushPromises()
    await w.find(`[role="dialog"] button[aria-label="${who}"]`).trigger('click')
    for (const digit of pin) await w.find(`[role="dialog"] button[aria-label="${digit}"]`).trigger('click')
    await settle()
  }

  it('a correct adult PIN opens the settings session and goes to /settings', async () => {
    const w = await mountGate()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    await enterPin(w, 'Sam', '1234')

    expect(router.currentRoute.value.path).toBe('/settings')
    expect(useSettingsSessionStore().info).toMatchObject({ membershipId: SAM, displayName: 'Sam', role: 'owner' })
    expect(useOpenSettings().gateOpen.value).toBe(false)
    w.unmount()
  })

  it('a wrong PIN stays on the main screen with no session', async () => {
    const w = await mountGate()

    await enterPin(w, 'Alex', '1234')

    expect(w.find('[role="alert"]').text()).toBe("That PIN didn't match.")
    expect(router.currentRoute.value.path).toBe('/home')
    expect(useSettingsSessionStore().info).toBeNull()
    w.unmount()
  })

  it('/settings without a settings session redirects to /home', async () => {
    const w = await mountApp('/settings/household')
    expect(router.currentRoute.value.path).toBe('/home')
    await router.push('/settings')
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })
})

describe('SettingsShell', () => {
  it('shows the signed-in adult, every section and the owner sign-in marks', async () => {
    const w = await openShell(fakeApi())

    expect(w.find('h1').text()).toBe('Settings')
    expect(w.find('[data-testid="settings-adult"]').text()).toContain('Sam')
    const links = w.findAll('nav[aria-label="Settings sections"] a')
    expect(links).toHaveLength(13)
    expect(links[0]!.attributes('aria-current')).toBe('page')
    expect(w.findAll('nav a').filter((a) => a.text().includes('Requires owner sign-in')).map((a) => a.text().replace('Requires owner sign-in', '').trim())).toEqual([
      'Members', 'Displays', 'Delete household',
    ])
    w.unmount()
  })

  it('sections that are not built yet show Coming soon', async () => {
    const w = await openShell(fakeApi(), 'children')
    expect(w.find('h2').text()).toBe('Children')
    expect(w.text()).toContain('Coming soon')
    w.unmount()
  })

  it('Done returns to /home and ends the session', async () => {
    const w = await openShell(fakeApi())
    await buttonByText(w, 'Done').trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/home')
    expect(useSettingsSessionStore().info).toBeNull()
    w.unmount()
  })

  it('5 minutes idle ends the session and returns to /home', async () => {
    const w = await openShell(fakeApi())
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(router.currentRoute.value.path).toBe('/settings')

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(useSettingsSessionStore().info).toBeNull()
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  describe('Household', () => {
    it('is filled from the household and saves the parsed fields', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi)

      const name = inputByLabel(w, 'Household name')
      expect((name.element as HTMLInputElement).value).toBe('Rivera')
      expect((inputByLabel(w, 'ZIP code').element as HTMLInputElement).value).toBe('28202')

      await name.setValue('  Rivera-Chen ')
      await inputByLabel(w, 'ZIP code').setValue('')
      await w.find('button[aria-label="Increase Leave-by buffer"]').trigger('click')
      await inputByLabel(w, 'Starts').setValue('21:00')
      await inputByLabel(w, 'Night from').setValue('19:30')
      await w.find('button[role="switch"]').trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.updateHouseholdSettings).toHaveBeenCalledWith(SAM_AUTH, {
        name: 'Rivera-Chen',
        zip: null,
        timeZone: 'America/New_York',
        leaveByBufferMin: 25,
        defaultNightSleep: { start: '19:30', end: '05:00' },
        nightMode: { start: '21:00', end: '06:00' },
        diaperLogEnabled: true,
      })
      expect(w.find('[role="status"]').text()).toContain('Saved')
      await vi.advanceTimersByTimeAsync(3_000)
      expect(w.text()).not.toContain('Saved')
      w.unmount()
    })

    it('shows validation messages by the fields and does not save', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi)

      await inputByLabel(w, 'Household name').setValue('  ')
      await inputByLabel(w, 'ZIP code').setValue('123')
      await inputByLabel(w, 'Ends').setValue('20:00')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.text()).toContain('Give your household a name.')
      expect(w.text()).toContain('ZIP codes are 5 digits.')
      expect(w.text()).toContain('Start and end must be different times.')
      expect(settingsApi.updateHouseholdSettings).not.toHaveBeenCalled()
      w.unmount()
    })

    it('shows a validation error from the server', async () => {
      const settingsApi = fakeApi()
      settingsApi.updateHouseholdSettings.mockRejectedValue(new SettingsError('unknown time zone Mars/Base', 'invalid'))
      const w = await openShell(settingsApi)

      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.find('[role="alert"]').text()).toBe('Unknown time zone Mars/Base.')
      expect(w.text()).not.toContain('Saved')
      w.unmount()
    })

    it('offline: shows the banner and disables Save', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi)
      expect(w.find('[data-testid="settings-offline"]').exists()).toBe(false)

      setOnline(false)
      await settle()

      expect(w.find('[data-testid="settings-offline"]').text()).toContain('Connect to change settings')
      expect(buttonByText(w, 'Save').attributes('disabled')).toBeDefined()
      await buttonByText(w, 'Save').trigger('click')
      await settle()
      expect(settingsApi.updateHouseholdSettings).not.toHaveBeenCalled()
      w.unmount()
    })
  })

  describe('Sitter info', () => {
    it('edits the care notes and saves them trimmed, leaving out blanks', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi)

      const link = w.findAll('nav a').find((a) => a.text() === 'Sitter info')!
      await link.trigger('click')
      await settle()
      expect(router.currentRoute.value.path).toBe('/settings/sitter-info')
      expect(w.text()).toContain('Shown in the Care Info panel during Sitter Mode.')

      const pediatrician = inputByLabel(w, 'Pediatrician')
      expect((pediatrician.element as HTMLTextAreaElement).value).toBe('Dr. Patel 704-555-0199')
      await pediatrician.setValue('  Dr. Lee 704-555-0123  ')
      await inputByLabel(w, 'Where things are').setValue('   ')
      await inputByLabel(w, 'Household food rules').setValue('No juice')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.updateSitterInfo).toHaveBeenCalledWith(SAM_AUTH, {
        napInstructions: 'Theo naps in the crib with the sound machine on.',
        bedtime: 'Ivy 7:00 PM, Theo 6:30 PM',
        foodRules: 'No juice',
        emergencyContacts: 'Sam 704-555-0101 · Alex 704-555-0102',
        pediatrician: 'Dr. Lee 704-555-0123',
        address: '12 Maple St',
      })
      expect(useSettingsSessionStore().info).not.toBeNull()
      w.unmount()
    })
  })

  describe('About', () => {
    it('shows the app version and this display, and the policy pages keep the session', async () => {
      const w = await openShell(fakeApi(), 'about')

      expect(w.find('[data-testid="app-version"]').text()).toBe(__APP_VERSION__)
      expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/)
      expect(w.text()).toContain('Kitchen')

      await w.findAll('a').find((a) => a.text() === 'Privacy policy')!.trigger('click')
      await settle()
      expect(router.currentRoute.value.path).toBe('/privacy')
      expect(w.text()).toContain('Coming before launch')
      expect(useSettingsSessionStore().info).not.toBeNull()

      await buttonByText(w, 'Back').trigger('click')
      await settle()
      expect(router.currentRoute.value.path).toBe('/settings/about')
      w.unmount()
    })
  })
})
