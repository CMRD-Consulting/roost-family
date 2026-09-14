import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mutateDemo, resetDemoForTests } from '@/data/demo/demoHousehold'
import type { LogCommand } from '@/data/logCommands'
import { useLogStore } from '@/stores/logStore'
import MainScreen from './MainScreen.vue'

vi.mock('@/data/householdSource', async () => {
  const { demoSource } = await import('@/data/demo/demoSource')
  return {
    isDemo: true,
    DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' },
    selectSource: async () => demoSource,
    selectWriter: async () => (await import('@/data/demo/demoLogWriter')).createDemoLogWriter(),
  }
})
// MainScreen must not touch Supabase in demo mode; fail loudly if it does.
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const IBUPROFEN_THEO = 'eeeeeeee-0000-0000-0000-000000000001'

let pinia: Pinia

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

/** Holds a long-press target for its full 600 ms. */
async function hold(el: Element) {
  const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
  Object.defineProperties(down, { pointerId: { value: 1 }, pointerType: { value: 'touch' } })
  el.dispatchEvent(down)
  vi.advanceTimersByTime(600)
  await flushPromises()
}

/** Lets the demo writer's simulated latency pass. */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
  await flushPromises()
}

const buttonIn = (w: VueWrapper | ReturnType<VueWrapper['get']>, label: string) => {
  const found = w.findAll('button').find((b) => b.text() === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}

const theoCard = (w: VueWrapper) => w.findAll('[data-testid="kid-card"]').find((c) => c.text().includes('Theo'))!

async function mountMain() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/home', component: MainScreen },
      { path: '/removed', component: { render: () => null } },
    ],
  })
  await router.push('/home')
  await router.isReady()
  pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(MainScreen, { global: { plugins: [pinia, router] }, attachTo: document.body })
  // Loading the household and opening the (fake) IndexedDB offline queue take several macrotasks.
  for (let i = 0; i < 10; i++) await flushPromises()
  return wrapper
}

describe('MainScreen (demo source)', () => {
  beforeEach(() => {
    // The demo household is a lazily-built singleton keyed off the URL at first access;
    // reset it so each test's own ?manyKids/?conflict params (set after this hook runs) take effect.
    resetDemoForTests()
    // Leave setImmediate real so flushPromises can resolve.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(async () => {
    window.history.replaceState({}, '', '/')
    setOnline(true)
    vi.unstubAllGlobals()
    vi.useRealTimers()
    // The real offline queue lives in (fake) IndexedDB across tests; empty it.
    const { createOfflineQueue } = await import('@/data/offlineQueue')
    await createOfflineQueue().clear()
  })

  it('renders the clock, kid cards, medicine, dinner and log row', async () => {
    const wrapper = await mountMain()
    const text = wrapper.text()
    for (const expected of ['3:00 PM', 'Monday', 'September 14', 'Ivy', 'Theo', 'Awake 2h 40m', 'Infant ibuprofen', 'Next after 7:00 PM', 'Tacos']) {
      expect(text).toContain(expected)
    }
    expect(wrapper.findAll('[data-testid="kid-card"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-log-kind]')).toHaveLength(6)
    expect(wrapper.find('[data-testid="conflict"]').exists()).toBe(false)
    expect(text).not.toContain('Offline')
    wrapper.unmount()
  })

  it('switches to compact cards with many kids', async () => {
    window.history.replaceState({}, '', '/home?manyKids')
    const wrapper = await mountMain()
    expect(wrapper.findAll('[data-testid="kid-card-compact"]')).toHaveLength(6)
    expect(wrapper.findAll('[data-testid="kid-card"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('shows the dose conflict banner', async () => {
    window.history.replaceState({}, '', '/home?conflict')
    const wrapper = await mountMain()
    expect(wrapper.findAll('[data-testid="conflict"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Acknowledge')
    wrapper.unmount()
  })

  it('opens the PIN pad to acknowledge a dose alert', async () => {
    window.history.replaceState({}, '', '/home?conflict')
    const wrapper = await mountMain()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    await wrapper.get('[data-testid="conflict"] button').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Acknowledge dose alert')
    expect(dialog.find('button[aria-label="Sam"]').exists()).toBe(true)

    await dialog.findAll('button').find((b) => b.text() === 'Cancel')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders the conflict banner and medicine zone before kid cards when compact with a conflict', async () => {
    window.history.replaceState({}, '', '/home?conflict&manyKids')
    const wrapper = await mountMain()
    const html = wrapper.html()
    const conflictIndex = html.indexOf('data-testid="conflict"')
    const medicineIndex = html.indexOf('data-testid="medicine-line"')
    const firstKidCardIndex = html.indexOf('data-testid="kid-card-compact"')
    expect(conflictIndex).toBeGreaterThan(-1)
    expect(medicineIndex).toBeGreaterThan(-1)
    expect(firstKidCardIndex).toBeGreaterThan(-1)
    expect(conflictIndex).toBeLessThan(firstKidCardIndex)
    expect(medicineIndex).toBeLessThan(firstKidCardIndex)
    wrapper.unmount()
  })

  it('logs a feeding from the log row, shows it on the card with an undo toast, and undoes it', async () => {
    const wrapper = await mountMain()
    expect(theoCard(wrapper).text()).toContain('Milk · 1h 10m ago')

    await hold(wrapper.get('[data-log-kind="feeding"]').element)
    const sheet = wrapper.get('[role="dialog"]')
    expect(sheet.text()).toContain('Feeding')
    await sheet.get('[role="radiogroup"][aria-label="Child"]').findAll('[role="radio"]').find((r) => r.text().includes('Theo'))!.trigger('click')
    await sheet.get('[role="radiogroup"][aria-label="Feeding type"]').findAll('[role="radio"]').find((r) => r.text() === 'Milk')!.trigger('click')
    await flushPromises()
    await wrapper.get('[role="radiogroup"][aria-label="Amount"]').findAll('[role="radio"]').find((r) => r.text() === '6 oz')!.trigger('click')
    await buttonIn(wrapper, 'Save').trigger('click')
    await settle()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(theoCard(wrapper).text()).toContain('Milk · 0m ago')
    const toast = wrapper.get('[data-testid="undo-toast"]')
    expect(toast.text()).toContain('Saved')
    expect(toast.text()).not.toContain('offline')

    await buttonIn(wrapper, 'Undo').trigger('click')
    await settle()

    expect(theoCard(wrapper).text()).toContain('Milk · 1h 10m ago')
    expect(wrapper.find('[data-testid="undo-toast"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('the undo toast goes away after 10 seconds', async () => {
    const wrapper = await mountMain()
    const saving = useLogStore(pinia).submit({ kind: 'dinner.set', householdId: HOUSEHOLD_ID, text: 'Pizza', previous: 'Tacos' })
    await settle()
    await saving
    expect(wrapper.find('[data-testid="undo-toast"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(wrapper.find('[data-testid="undo-toast"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offline: says "Saved offline — will sync" and shows a Syncing badge until the queue is sent', async () => {
    const wrapper = await mountMain()
    setOnline(false)
    await flushPromises()

    await useLogStore(pinia).submit({ kind: 'dinner.set', householdId: HOUSEHOLD_ID, text: 'Pizza', previous: 'Tacos' })
    await flushPromises()

    expect(wrapper.get('[data-testid="undo-toast"]').text()).toContain('Saved offline — will sync')
    expect(wrapper.get('[data-testid="syncing"]').text()).toBe('Syncing 1…')
    expect(wrapper.text()).toContain('Offline')
    expect(wrapper.text()).toContain('Pizza')

    setOnline(true)
    await settle()
    await settle()
    expect(wrapper.find('[data-testid="syncing"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('undoing a just-logged dose opens the PIN pad', async () => {
    const wrapper = await mountMain()
    const dose: LogCommand = {
      kind: 'dose.add',
      householdId: HOUSEHOLD_ID,
      entry: {
        id: 'dose-new', childId: THEO, medicineId: IBUPROFEN_THEO, at: '2026-09-14T19:00:00.000Z', loggedByName: 'Sam',
        loggedOffline: false, voidedAt: null, conflictAcknowledgedAt: null, createdAt: '2026-09-14T19:00:00.000Z', note: null,
        warningsConfirmed: ['early'],
      },
      attribution: { displayId: 'demo-display', loggedByMembershipId: SAM, sitterSessionId: null, loggedByName: 'Sam' },
    }
    const saving = useLogStore(pinia).submit(dose)
    await settle()
    await saving

    await buttonIn(wrapper, 'Undo').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Undo dose')
    wrapper.unmount()
  })

  it('shows replay failures in a dismissible banner', async () => {
    const wrapper = await mountMain()
    const logStore = useLogStore(pinia)
    logStore.failures = ['rejected by server', "A log couldn't be saved because its entry no longer exists."]
    await flushPromises()

    const banners = wrapper.findAll('[data-testid="log-failure"]')
    expect(banners.map((b) => b.text())).toEqual([
      "A log couldn't be saved: rejected by server ✕",
      "A log couldn't be saved because its entry no longer exists. ✕",
    ])
    await banners[0]!.get('button[aria-label="Dismiss"]').trigger('click')
    expect(logStore.failures).toEqual(["A log couldn't be saved because its entry no longer exists."])
    wrapper.unmount()
  })

  it('a stale sleep on a kid card opens "Still sleeping?" and ending it fixes the card', async () => {
    mutateDemo((s) => ({
      ...s,
      sleeps: [
        ...s.sleeps.filter((e) => e.childId !== THEO),
        { id: 'sleep-stale', childId: THEO, startAt: '2026-09-14T02:00:00.000Z', endAt: null, type: 'night' },
      ],
    }))
    const wrapper = await mountMain()
    expect(theoCard(wrapper).text()).toContain('Still sleeping?')

    await theoCard(wrapper).get('[data-testid="fix-sleep"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('never ended')

    await buttonIn(wrapper, 'End sleep').trigger('click')
    await settle()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(theoCard(wrapper).text()).not.toContain('Still sleeping?')
    expect(theoCard(wrapper).text()).toContain('Awake 0m')
    wrapper.unmount()
  })

  it("long-pressing tonight's dinner edits it", async () => {
    const wrapper = await mountMain()
    await hold(wrapper.get('[data-testid="dinner-line"]').element)
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Dinner')

    await dialog.get('input').setValue('Pasta')
    await buttonIn(wrapper, 'Save').trigger('click')
    await settle()

    expect(wrapper.get('[data-testid="dinner-line"]').text()).toContain('Pasta')
    wrapper.unmount()
  })

  it('starts the log store on mount and stops it on unmount', async () => {
    const wrapper = await mountMain()
    const logStore = useLogStore(pinia)
    const stop = vi.spyOn(logStore, 'stop')
    // Initialized: submitting doesn't throw "init() must be called".
    const saving = logStore.submit({ kind: 'dinner.set', householdId: HOUSEHOLD_ID, text: 'Pizza', previous: 'Tacos' })
    await settle()
    await expect(saving).resolves.toBe('saved')
    wrapper.unmount()
    expect(stop).toHaveBeenCalled()
  })
})
