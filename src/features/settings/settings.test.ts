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

type FakeSettingsApi = SettingsApi & Record<
  | 'settingsVerify' | 'updateHouseholdSettings' | 'updateSitterInfo'
  | 'addChild' | 'updateChild' | 'setFeatureOverride'
  | 'upsertMedicine' | 'archiveMedicine'
  | 'upsertStickerCategory' | 'archiveStickerCategory'
  | 'upsertRoutine' | 'deleteRoutine' | 'setRoutineDayOverride',
  ReturnType<typeof vi.fn>
>

function fakeApi(): FakeSettingsApi {
  return {
    settingsVerify: vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' }),
    updateHouseholdSettings: vi.fn().mockResolvedValue(undefined),
    updateSitterInfo: vi.fn().mockResolvedValue(undefined),
    addChild: vi.fn().mockResolvedValue('new-child-id'),
    updateChild: vi.fn().mockResolvedValue(undefined),
    setFeatureOverride: vi.fn().mockResolvedValue(undefined),
    upsertMedicine: vi.fn().mockResolvedValue('new-medicine-id'),
    archiveMedicine: vi.fn().mockResolvedValue(undefined),
    upsertStickerCategory: vi.fn().mockResolvedValue('new-category-id'),
    archiveStickerCategory: vi.fn().mockResolvedValue(undefined),
    upsertRoutine: vi.fn().mockResolvedValue('new-routine-id'),
    deleteRoutine: vi.fn().mockResolvedValue(undefined),
    setRoutineDayOverride: vi.fn().mockResolvedValue(undefined),
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
    const w = await openShell(fakeApi(), 'members')
    expect(w.find('h2').text()).toBe('Members')
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

  describe('Children', () => {
    const IVY = 'cccccccc-0000-0000-0000-000000000001'
    const THEO = 'cccccccc-0000-0000-0000-000000000002'

    it('lists each child with their age and opens an edit panel prefilled from their profile', async () => {
      const w = await openShell(fakeApi(), 'children')

      const rows = w.findAll('li').map((li) => li.text())
      expect(rows.some((t) => t.includes('Ivy') && t.includes('3 yrs'))).toBe(true)
      expect(rows.some((t) => t.includes('Theo') && t.includes('1 yr'))).toBe(true)

      await buttonByText(w, 'Edit Ivy').trigger('click')
      await settle()

      expect((inputByLabel(w, 'Name').element as HTMLInputElement).value).toBe('Ivy')
      expect((inputByLabel(w, 'Birthday').element as HTMLInputElement).value).toBe('2023-04-10')
      // Ivy has her own night-sleep window, so the household-default toggle starts off.
      expect(w.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
      expect((inputByLabel(w, 'Night from').element as HTMLInputElement).value).toBe('19:00')
      w.unmount()
    })

    it('saves a profile edit', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'children')

      await buttonByText(w, 'Edit Ivy').trigger('click')
      await settle()
      await inputByLabel(w, 'Allergies').setValue('Peanuts')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.updateChild).toHaveBeenCalledWith(SAM_AUTH, {
        childId: IVY,
        name: 'Ivy',
        birthday: '2023-04-10',
        color: expect.any(String),
        allergies: 'Peanuts',
        foodRules: '',
        nightSleep: { start: '19:00', end: '06:00' },
      })
      w.unmount()
    })

    it('shows validation messages and does not save an empty name', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'children')

      await buttonByText(w, 'Edit Ivy').trigger('click')
      await settle()
      await inputByLabel(w, 'Name').setValue('  ')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.text()).toContain('Give this child a name.')
      expect(settingsApi.updateChild).not.toHaveBeenCalled()
      w.unmount()
    })

    it('adds a child from the small add-child panel', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'children')

      await buttonByText(w, '+ Add child').trigger('click')
      await settle()
      await inputByLabel(w, 'Name').setValue('  Mo  ')
      await inputByLabel(w, 'Birthday').setValue('2024-01-01')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.addChild).toHaveBeenCalledWith(SAM_AUTH, { name: 'Mo', birthday: '2024-01-01', color: expect.any(String) })
      w.unmount()
    })

    it('shows the age-based default per feature and only saves the override that changed', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'children')

      // Ivy is 3, so Kids' Corner defaults on and the wake window/feeding default off.
      await buttonByText(w, 'Edit Ivy').trigger('click')
      await settle()
      expect(w.find('[data-testid="override-kidsCorner"]').text()).toContain('Default (On)')
      expect(w.find('[data-testid="override-wakeWindow"]').text()).toContain('Default (Off)')

      const kidsCornerOff = w.find('[data-testid="override-kidsCorner"]').findAll('button').find((b) => b.text() === 'Off')!
      await kidsCornerOff.trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.setFeatureOverride).toHaveBeenCalledExactlyOnceWith(SAM_AUTH, IVY, 'kidsCorner', false)
      w.unmount()
    })

    it('clearing an override back to Default sends null', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'children')

      // Theo's wake window defaults on; explicitly picking On then Default should clear it (null).
      await buttonByText(w, 'Edit Theo').trigger('click')
      await settle()
      const wakeWindowRow = () => w.find('[data-testid="override-wakeWindow"]')
      await wakeWindowRow().findAll('button').find((b) => b.text() === 'Off')!.trigger('click')
      await wakeWindowRow().findAll('button').find((b) => b.text().startsWith('Default'))!.trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.setFeatureOverride).not.toHaveBeenCalled()
      w.unmount()
    })
  })

  describe('Routines', () => {
    const IVY = 'cccccccc-0000-0000-0000-000000000001'
    const HOME_DAY = 'routine-ivy-homeday'
    const WEEKEND = 'routine-ivy-weekend'

    function routineRow(w: VueWrapper, name: string) {
      const row = w.findAll('[data-testid="routine-row"]').find((r) => r.text().includes(name))
      if (!row) throw new Error(`No routine row "${name}"`)
      return row
    }

    it("lists the child's routines with their weekdays and shows which routine runs today", async () => {
      const w = await openShell(fakeApi(), 'routines')

      expect(w.find('h2').text()).toBe('Routines')
      expect(routineRow(w, 'Home day').text()).toContain('Mon')
      expect(routineRow(w, 'Home day').text()).toContain('Fri')
      expect(routineRow(w, 'Weekend').text()).toContain('Sun')
      expect(routineRow(w, 'Weekend').text()).toContain('Sat')
      const today = inputByLabel(w, 'Switch today’s routine')
      expect((today.element as HTMLSelectElement).value).toBe('')
      expect(today.findAll('option').map((o) => o.text())).toEqual(['Use the weekday default (Home day)', 'Home day', 'Weekend'])

      await w.find('[role="radiogroup"][aria-label="Child"]').findAll('[role="radio"]').find((r) => r.text() === 'Theo')!.trigger('click')
      await settle()
      expect(w.text()).toContain('No routines yet for Theo.')
      w.unmount()
    })

    it("switches today's routine and back to the weekday default", async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'routines')

      await inputByLabel(w, 'Switch today’s routine').setValue(WEEKEND)
      await settle()
      expect(settingsApi.setRoutineDayOverride).toHaveBeenLastCalledWith(SAM_AUTH, IVY, '2026-09-14', WEEKEND)

      await inputByLabel(w, 'Switch today’s routine').setValue('')
      await settle()
      expect(settingsApi.setRoutineDayOverride).toHaveBeenLastCalledWith(SAM_AUTH, IVY, '2026-09-14', null)
      w.unmount()
    })

    it('creates a routine, warning about a weekday another routine already uses', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'routines')

      await buttonByText(w, '+ New routine').trigger('click')
      await settle()
      await inputByLabel(w, 'Routine name').setValue('  Grandma day ')
      await w.find('[role="group"][aria-label="Weekdays"] button[aria-label="Saturday"]').trigger('click')
      await settle()
      expect(w.text()).toContain('Weekend already uses Saturday — the first routine wins.')

      await buttonByText(w, '+ Add step').trigger('click')
      await settle()
      await inputByLabel(w, 'Step 1 label').setValue('Pancakes')
      await w.find('button[aria-label="Choose an icon for step 1"]').trigger('click')
      await w.find('[role="radiogroup"][aria-label="Icon for step 1"] [role="radio"][aria-label="Breakfast"]').trigger('click')
      await w.find('button[role="switch"][aria-label="Step 1 has a time"]').trigger('click')
      await inputByLabel(w, 'Step 1 time').setValue('08:15')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.upsertRoutine).toHaveBeenCalledWith(SAM_AUTH, {
        routineId: null,
        childId: IVY,
        name: 'Grandma day',
        weekdays: [6],
        steps: [{ iconKey: 'breakfast', photoId: null, label: 'Pancakes', time: '08:15' }],
      })
      w.unmount()
    })

    it('does not save a routine without a name or with an unlabelled step', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'routines')

      await buttonByText(w, '+ New routine').trigger('click')
      await settle()
      await buttonByText(w, '+ Add step').trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.text()).toContain('Give this routine a name.')
      expect(w.text()).toContain('Give this step a label.')
      expect(settingsApi.upsertRoutine).not.toHaveBeenCalled()
      w.unmount()
    })

    it('edits a routine: reordering steps saves them in the new order, and out-of-order times warn', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'routines')

      await routineRow(w, 'Weekend').find('button').trigger('click')
      await settle()
      expect((inputByLabel(w, 'Routine name').element as HTMLInputElement).value).toBe('Weekend')
      expect(w.text()).not.toContain('Some timed steps are out of order')

      // Weekend: Breakfast, Park, Bath 18:15, Bed 19:00. Move Bed above Bath.
      await w.find('button[aria-label="Move step 4 up"]').trigger('click')
      await settle()
      expect(w.text()).toContain('Some timed steps are out of order')
      await w.find('button[aria-label="Remove step 2"]').trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.upsertRoutine).toHaveBeenCalledWith(SAM_AUTH, {
        routineId: WEEKEND,
        childId: IVY,
        name: 'Weekend',
        weekdays: [0, 6],
        steps: [
          { iconKey: 'breakfast', photoId: null, label: 'Breakfast', time: null },
          { iconKey: 'bed', photoId: null, label: 'Bed', time: '19:00' },
          { iconKey: 'bath', photoId: null, label: 'Bath', time: '18:15' },
        ],
      })
      w.unmount()
    })

    it('deletes a routine after confirming', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'routines')

      await routineRow(w, 'Home day').find('button').trigger('click')
      await settle()
      await buttonByText(w, 'Delete routine').trigger('click')
      await settle()
      expect(w.text()).toContain('Delete Home day?')
      expect(settingsApi.deleteRoutine).not.toHaveBeenCalled()
      await buttonByText(w, 'Delete').trigger('click')
      await settle()

      expect(settingsApi.deleteRoutine).toHaveBeenCalledWith(SAM_AUTH, HOME_DAY)
      w.unmount()
    })

    it('saves against the demo household so Kids’ Corner sees the change', async () => {
      const demo = (await import('@/data/demo/demoSettingsApi')).createDemoSettingsApi()
      const w = await openShell(demo, 'routines')

      await routineRow(w, 'Home day').find('button').trigger('click')
      await settle()
      await buttonByText(w, '+ Add step').trigger('click')
      await inputByLabel(w, 'Step 10 label').setValue('Wash hands')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      const homeDay = useHouseholdStore().view!.routines.find((r) => r.id === HOME_DAY)!
      expect(homeDay.steps.at(-1)).toEqual({ iconKey: null, photoId: null, label: 'Wash hands', time: null })
      w.unmount()
    })
  })

  describe('Medicines', () => {
    const THEO = 'cccccccc-0000-0000-0000-000000000002'

    it('lists medicines for the selected child with their interval and maximum', async () => {
      const w = await openShell(fakeApi(), 'medicines')

      expect(w.text()).toContain('Enter intervals and maximums from the label or your doctor.');
      expect(w.text()).toContain('Roost Family doesn’t give dosing advice.')
      // Ivy is selected first (sort order 0) and has one medicine.
      expect(w.text()).toContain('Every 6h · max 4/day')

      await w.find('[role="radiogroup"][aria-label="Child"]').findAll('[role="radio"]').find((r) => r.text() === 'Theo')!.trigger('click')
      await settle()
      expect(w.text()).toContain('Infant ibuprofen')
      expect(w.text()).toContain('Infant acetaminophen')
      w.unmount()
    })

    it('adds a medicine for the selected child', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'medicines')

      await w.find('[role="radiogroup"][aria-label="Child"]').findAll('[role="radio"]').find((r) => r.text() === 'Theo')!.trigger('click')
      await settle()
      await buttonByText(w, '+ Add medicine').trigger('click')
      await settle()
      await inputByLabel(w, 'Name').setValue('Amoxicillin')
      await w.find('button[aria-label="Increase Minimum hours between doses"]').trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.upsertMedicine).toHaveBeenCalledWith(SAM_AUTH, {
        medicineId: null, childId: THEO, name: 'Amoxicillin', minIntervalHours: 1, maxDosesPer24h: null,
      })
      w.unmount()
    })

    it('does not save a blank medicine name', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'medicines')

      await buttonByText(w, '+ Add medicine').trigger('click')
      await settle()
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.text()).toContain('Give this medicine a name.')
      expect(settingsApi.upsertMedicine).not.toHaveBeenCalled()
      w.unmount()
    })

    it('archives a medicine after confirming', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'medicines')

      // Ivy is selected first and has one medicine, "Children's ibuprofen".
      await w.find('button[aria-label="Archive Children\'s ibuprofen"]').trigger('click')
      await settle()
      expect(w.text()).toContain("Archive Children's ibuprofen?")
      await buttonByText(w, 'Archive').trigger('click')
      await settle()

      expect(settingsApi.archiveMedicine).toHaveBeenCalledWith(SAM_AUTH, expect.any(String))
      w.unmount()
    })
  })

  describe('Stickers', () => {
    it('lists the sticker categories and adds a new one', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'stickers')

      expect(w.text()).toContain('Potty')
      expect(w.text()).toContain('Teeth')

      await buttonByText(w, '+ Add category').trigger('click')
      await settle()
      await inputByLabel(w, 'Name').setValue('Sharing')
      await w.find('[role="radiogroup"][aria-label="Icon"] [role="radio"][aria-label="Snack"]').trigger('click')
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(settingsApi.upsertStickerCategory).toHaveBeenCalledWith(SAM_AUTH, {
        categoryId: null, name: 'Sharing', iconKey: 'snack', sortOrder: null,
      })
      w.unmount()
    })

    it('requires a name and an icon', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'stickers')

      await buttonByText(w, '+ Add category').trigger('click')
      await settle()
      await buttonByText(w, 'Save').trigger('click')
      await settle()

      expect(w.text()).toContain('Give this category a name.')
      expect(w.text()).toContain('Pick an icon.')
      expect(settingsApi.upsertStickerCategory).not.toHaveBeenCalled()
      w.unmount()
    })

    it('moves a category down, swapping sort order with its neighbor', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'stickers')

      await w.find('button[aria-label="Move Potty down"]').trigger('click')
      await settle()

      expect(settingsApi.upsertStickerCategory).toHaveBeenCalledWith(SAM_AUTH, { categoryId: expect.any(String), name: 'Teeth', iconKey: 'teeth', sortOrder: 0 })
      expect(settingsApi.upsertStickerCategory).toHaveBeenCalledWith(SAM_AUTH, { categoryId: expect.any(String), name: 'Potty', iconKey: 'potty', sortOrder: 1 })
      w.unmount()
    })

    it('archives a category after confirming', async () => {
      const settingsApi = fakeApi()
      const w = await openShell(settingsApi, 'stickers')

      await w.find('button[aria-label="Archive Potty"]').trigger('click')
      await settle()
      expect(w.text()).toContain('Archive Potty?')
      await buttonByText(w, 'Archive').trigger('click')
      await settle()

      expect(settingsApi.archiveStickerCategory).toHaveBeenCalledWith(SAM_AUTH, expect.any(String))
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
