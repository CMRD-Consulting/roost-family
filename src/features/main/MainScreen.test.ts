import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { getDemoSnapshot, mutateDemo, resetDemoForTests } from '@/data/demo/demoHousehold'
import type { LogCommand } from '@/data/logCommands'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
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
    // modesStore persists Nap Mode to localStorage; without this a nap left on by one test would
    // leak into the next (which creates a fresh Pinia, but not fresh localStorage).
    localStorage.clear()
    // Leave setImmediate real so flushPromises can resolve.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(async () => {
    window.history.replaceState({}, '', '/')
    setOnline(true)
    localStorage.clear()
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

  it('shows a "Showing saved info" badge while the view is the device cache\'s last-known snapshot', async () => {
    const wrapper = await mountMain()
    expect(wrapper.text()).not.toContain('Showing saved info')

    useHouseholdStore().fromCache = true
    await flushPromises()

    expect(wrapper.text()).toContain('Showing saved info from 3:00 PM')
    wrapper.unmount()
  })

  // 1024x768: with Offline, saved-info and Syncing badges beside the buttons the date used to wrap
  // ("September / 14"). The badges now sit in their own row under the clock line, so the clock line only
  // shares the header's width with the four 60 px buttons (~460 px of clock and date in ~656 px).
  it('puts status badges in their own row under the clock line, and never wraps the date', async () => {
    const wrapper = await mountMain()
    expect(wrapper.find('[data-testid="status-badges"]').exists()).toBe(false)

    setOnline(false)
    useHouseholdStore(pinia).fromCache = true
    await flushPromises()

    const header = wrapper.get('header')
    const badges = header.get('[data-testid="status-badges"]')
    expect(badges.text()).toContain('Offline')
    expect(badges.text()).toContain('Showing saved info from 3:00 PM')
    expect(badges.classes()).toContain('flex-nowrap')
    // Same column as the clock line, below it; not in the row with the buttons.
    const clockLine = header.get('[data-testid="clock-line"]')
    expect(badges.element.parentElement).toBe(clockLine.element.parentElement)
    expect(clockLine.element.compareDocumentPosition(badges.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(header.get('button[aria-label="Nap Mode"]').element.contains(badges.element)).toBe(false)
    expect(badges.element.contains(header.get('button[aria-label="Nap Mode"]').element)).toBe(false)

    const date = header.get('[data-testid="clock-date"]')
    expect(date.classes()).toContain('whitespace-nowrap')
    expect(date.text()).toContain('September 14')
    // Every badge stays at the 16 px text floor.
    for (const badge of badges.findAll('[role="status"]')) expect(badge.classes()).toContain('text-[16px]')
    wrapper.unmount()
  })

  it('warns that recent doses can\'t be checked while showing saved info', async () => {
    const wrapper = await mountMain()
    expect(wrapper.find('[data-testid="medicine-stale"]').exists()).toBe(false)

    useHouseholdStore().fromCache = true
    await flushPromises()

    const warning = wrapper.get('[data-testid="medicine-stale"]')
    expect(warning.text()).toBe('Can’t check recent doses — confirm before giving medicine.')
    expect(warning.classes()).toEqual(expect.arrayContaining(['text-[18px]', 'text-warn-ink']))
    wrapper.unmount()
  })

  it('warns that recent doses can\'t be checked once realtime has been down for more than 5 minutes', async () => {
    const wrapper = await mountMain()
    const store = useHouseholdStore()
    store.realtime = 'disconnected'
    store.realtimeDownSince = new Date(Date.now()).toISOString()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flushPromises()
    expect(wrapper.find('[data-testid="medicine-stale"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(wrapper.find('[data-testid="medicine-stale"]').exists()).toBe(true)
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

  // Safety zones must never scroll below the fold on a 1024x768 tablet: they come before the kid cards in every layout.
  it.each([
    ['regular layout with a conflict', '/home?conflict', 'kid-card', true],
    ['regular layout, medicine only', '/home', 'kid-card', false],
    ['compact layout with a conflict', '/home?conflict&manyKids', 'kid-card-compact', true],
    ['compact layout, medicine only', '/home?manyKids', 'kid-card-compact', false],
  ])('renders the conflict banner and medicine zone before the kid cards (%s)', async (_name, url, cardTestId, conflict) => {
    window.history.replaceState({}, '', url)
    const wrapper = await mountMain()
    const html = wrapper.html()
    const conflictIndex = html.indexOf('data-testid="conflict"')
    const medicineIndex = html.indexOf('data-testid="medicine-line"')
    const firstKidCardIndex = html.indexOf(`data-testid="${cardTestId}"`)
    expect(medicineIndex).toBeGreaterThan(-1)
    expect(firstKidCardIndex).toBeGreaterThan(-1)
    expect(medicineIndex).toBeLessThan(firstKidCardIndex)
    if (conflict) {
      expect(conflictIndex).toBeGreaterThan(-1)
      expect(conflictIndex).toBeLessThan(medicineIndex)
    } else {
      expect(conflictIndex).toBe(-1)
    }
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

  it('clears the Offline badge on the next successful household load, without waiting for the display check', async () => {
    const wrapper = await mountMain()
    const displayStore = useDisplayStore(pinia)
    displayStore.state = { kind: 'offline' }
    await flushPromises()
    expect(wrapper.text()).toContain('Offline')

    await useHouseholdStore(pinia).reload()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Offline')
    expect(displayStore.state).not.toEqual({ kind: 'offline' })
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

  describe('Sitter Mode', () => {
    async function enterPin(w: VueWrapper, name: string, pin: string) {
      await w.get(`[role="dialog"] button[aria-label="${name}"]`).trigger('click')
      await flushPromises()
      for (const digit of pin) {
        await w.get(`[role="dialog"] button[aria-label="${digit}"]`).trigger('click')
        await flushPromises()
      }
    }

    it('starts with an adult PIN and a sitter name: pill, care info, and no Jot it, Grocery or Settings', async () => {
      const wrapper = await mountMain()
      expect(wrapper.find('[data-testid="sitter-pill"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(true)

      await hold(wrapper.get('button[aria-label="Sitter Mode"]').element)
      const dialog = wrapper.get('[role="dialog"]')
      expect(dialog.text()).toContain('Start Sitter Mode')
      await enterPin(wrapper, 'Sam', '1234')

      expect(wrapper.get('[role="dialog"]').text()).toContain("Who's watching the kids?")
      await wrapper.get('[role="dialog"] input').setValue('  Jess ')
      expect(wrapper.get('[role="dialog"]').text()).toContain('Their entries will show as "Jess (sitter)".')
      await buttonIn(wrapper.get('[role="dialog"]'), 'Start Sitter Mode').trigger('click')
      await settle()
      await settle()

      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      const session = getDemoSnapshot(new Date()).activeSitterSession
      expect(session).toMatchObject({ sitterName: 'Jess', endedAt: null })

      const pill = wrapper.get('[data-testid="sitter-pill"]')
      expect(pill.text()).toBe('Sitter Mode · Jess')
      expect(pill.classes()).toContain('text-[22px]')
      expect(wrapper.find('[data-testid="care-info"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="dinner-line"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Calendar arrives')
      expect(wrapper.findAll('[data-log-kind]').map((b) => b.attributes('data-log-kind'))).toEqual(['sleep', 'feeding', 'medicine', 'sticker'])
      expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Sitter Mode"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Kids\' Corner"]').exists()).toBe(true)
      const end = buttonIn(wrapper, 'End Sitter Mode')
      expect(end.classes()).toContain('h-[60px]')
      wrapper.unmount()
    })

    it('says "Sitter Mode" without a name', async () => {
      mutateDemo((s) => ({
        ...s,
        activeSitterSession: { id: 'sitter-anon', sitterName: null, startedAt: '2026-09-14T18:00:00.000Z', endedAt: null, summaryShownAt: null },
      }))
      const wrapper = await mountMain()
      expect(wrapper.get('[data-testid="sitter-pill"]').text()).toBe('Sitter Mode')
      wrapper.unmount()
    })

    it('log sheets attribute to the sitter', async () => {
      window.history.replaceState({}, '', '/home?sitter')
      const wrapper = await mountMain()
      await hold(wrapper.get('[data-log-kind="feeding"]').element)
      const sheet = wrapper.get('[role="dialog"]')
      await sheet.get('[role="radiogroup"][aria-label="Feeding type"]').findAll('[role="radio"]').find((r) => r.text() === 'Milk')!.trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="sitter-who"]').text()).toBe('Logged by Jess (sitter)')
      expect(wrapper.find('[role="radiogroup"][aria-label="Who"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('ends with an adult PIN, shows the summary, and Done marks it shown', async () => {
      window.history.replaceState({}, '', '/home?sitter')
      const wrapper = await mountMain()
      expect(wrapper.get('[data-testid="sitter-pill"]').text()).toBe('Sitter Mode · Jess')

      await hold(buttonIn(wrapper, 'End Sitter Mode').element)
      expect(wrapper.get('[role="dialog"]').text()).toContain('End Sitter Mode')
      await enterPin(wrapper, 'Alex', '5678')
      await settle()

      expect(getDemoSnapshot(new Date()).activeSitterSession).toBeNull()
      const summary = wrapper.get('[data-testid="sitter-summary"]')
      expect(summary.text()).toContain('While you were out')
      expect(summary.get('[data-testid="summary-sitter"]').text()).toBe('Jess · 1:00 PM – 3:00 PM')
      const cards = summary.findAll('[data-testid="summary-child"]')
      expect(cards.map((c) => c.get('h2').text())).toEqual(['Ivy', 'Theo'])
      expect(cards[0]!.text()).toContain('Sticker: Teeth')
      expect(cards[1]!.text()).toContain('Meal · Pasta and peas')
      expect(cards[1]!.text()).toContain('Infant acetaminophen · 5 ml')
      // The display that ended the session doesn't also get the "see summary" banner.
      expect(wrapper.find('[data-testid="sitter-summary-banner"]').exists()).toBe(false)

      await buttonIn(summary, 'Done').trigger('click')
      await settle()

      expect(wrapper.find('[data-testid="sitter-summary"]').exists()).toBe(false)
      expect(getDemoSnapshot(new Date()).recentSitterSession?.summaryShownAt).not.toBeNull()
      expect(wrapper.find('[data-testid="sitter-pill"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="sitter-summary-banner"]').exists()).toBe(false)
      expect(wrapper.find('[data-log-kind="jot"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('a wrong PIN does not end Sitter Mode', async () => {
      window.history.replaceState({}, '', '/home?sitter')
      const wrapper = await mountMain()
      await hold(buttonIn(wrapper, 'End Sitter Mode').element)
      await enterPin(wrapper, 'Alex', '0000')
      await settle()
      expect(wrapper.get('[role="dialog"]').text()).toContain("That PIN didn't match.")
      expect(getDemoSnapshot(new Date()).activeSitterSession).not.toBeNull()
      wrapper.unmount()
    })

    it('another display shows a banner for an unseen summary; an adult PIN opens it and Done marks it shown', async () => {
      mutateDemo((s) => ({
        ...s,
        recentSitterSession: {
          id: 'sitter-ended', sitterName: 'Jess', startedAt: '2026-09-14T16:00:00.000Z', endedAt: '2026-09-14T18:10:00.000Z', summaryShownAt: null,
        },
      }))
      const wrapper = await mountMain()
      const banner = wrapper.get('[data-testid="sitter-summary-banner"]')
      expect(banner.text()).toBe('Sitter session with Jess ended at 2:10 PM · See summary')
      expect(banner.classes()).toContain('min-h-[60px]')

      await banner.trigger('click')
      await flushPromises()
      await enterPin(wrapper, 'Sam', '1234')
      await settle()

      const summary = wrapper.get('[data-testid="sitter-summary"]')
      expect(summary.get('[data-testid="summary-sitter"]').text()).toBe('Jess · 12:00 PM – 2:10 PM')
      await buttonIn(summary, 'Done').trigger('click')
      await settle()

      expect(getDemoSnapshot(new Date()).recentSitterSession?.summaryShownAt).not.toBeNull()
      expect(wrapper.find('[data-testid="sitter-summary"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="sitter-summary-banner"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('offline: asks for a connection to start Sitter Mode', async () => {
      const wrapper = await mountMain()
      setOnline(false)
      await flushPromises()
      await hold(wrapper.get('button[aria-label="Sitter Mode"]').element)
      expect(wrapper.get('[role="dialog"]').text()).toContain('Connect to start Sitter Mode.')
      expect(wrapper.find('[role="dialog"] button[aria-label="Sam"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('offline: asks for a connection to end Sitter Mode', async () => {
      window.history.replaceState({}, '', '/home?sitter')
      const wrapper = await mountMain()
      setOnline(false)
      await flushPromises()
      await hold(buttonIn(wrapper, 'End Sitter Mode').element)
      expect(wrapper.get('[role="dialog"]').text()).toContain('Connect to end Sitter Mode.')
      expect(wrapper.find('[role="dialog"] button[aria-label="Alex"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('the sitter pill stays visible in the Night Mode peek', async () => {
      window.history.replaceState({}, '', '/home?sitter')
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
      const wrapper = await mountMain()
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)

      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="sitter-pill"]').text()).toBe('Sitter Mode · Jess')
      wrapper.unmount()
    })
  })

  describe('Night screen and Nap overlay', () => {
    it('shows the Night screen and hides the log row during the household night window', async () => {
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z')) // 10pm household time (night window 8pm-6am)
      const wrapper = await mountMain()

      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      expect(wrapper.find('[data-log-kind]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tapping the Night screen peeks at the main screen with a countdown, then returns to Night', async () => {
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
      const wrapper = await mountMain()

      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)
      expect(wrapper.find('[data-log-kind]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="night-peek-chip"]').text()).toContain('Night Mode')

      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()

      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('a sheet open at the night boundary stays open, and Night Mode starts once it closes', async () => {
      vi.setSystemTime(new Date('2026-09-14T23:59:50Z')) // 7:59:50 PM household time
      const wrapper = await mountMain()
      await hold(wrapper.get('[data-testid="dinner-line"]').element)
      expect(wrapper.get('[role="dialog"]').text()).toContain('Dinner')

      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="night-peek-chip"]').text()).toBe("Night Mode · when you're done")

      // Closed without a tap on the screen (Escape), so no peek is started: Night Mode takes over at once.
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('a PIN dialog open when a peek runs out keeps Night Mode away', async () => {
      window.history.replaceState({}, '', '/home?conflict')
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
      const wrapper = await mountMain()
      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="conflict"] button').trigger('click')
      await flushPromises()

      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await flushPromises()
      expect(wrapper.get('[role="dialog"]').text()).toContain('Acknowledge dose alert')
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('each tap during a peek keeps the main screen up for 60 seconds from that tap', async () => {
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
      const wrapper = await mountMain()
      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      await flushPromises()

      await vi.advanceTimersByTimeAsync(50_000)
      wrapper.get('[data-testid="clock-line"]').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(50_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="night-peek-chip"]').text()).toBe('Night Mode · back in 0:10')
      await vi.advanceTimersByTimeAsync(1_000)
      await flushPromises()
      expect(wrapper.get('[data-testid="night-peek-chip"]').text()).toBe('Night Mode · back in 0:09')

      await vi.advanceTimersByTimeAsync(9_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('the moon button toggles Nap Mode and reports it with aria-pressed', async () => {
      const wrapper = await mountMain()
      const moon = wrapper.get('button[aria-label="Nap Mode"]')
      expect(moon.attributes('aria-pressed')).toBe('false')
      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(false)

      await moon.trigger('click')
      await flushPromises()
      expect(moon.attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('[data-testid="nap-overlay"]').text()).toContain('Nap Mode')

      await moon.trigger('click')
      await flushPromises()
      expect(moon.attributes('aria-pressed')).toBe('false')
      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('the Nap overlay does not block a log button long-press', async () => {
      const wrapper = await mountMain()
      await wrapper.get('button[aria-label="Nap Mode"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(true)

      await hold(wrapper.get('[data-log-kind="feeding"]').element)
      expect(wrapper.get('[role="dialog"]').text()).toContain('Feeding')
      wrapper.unmount()
    })

    it('nap ends automatically once the sleep open when it started has ended', async () => {
      mutateDemo((s) => ({
        ...s,
        sleeps: [...s.sleeps, { id: 'sleep-nap-live', childId: THEO, startAt: '2026-09-14T18:30:00.000Z', endAt: null, type: 'nap' as const }],
      }))
      const wrapper = await mountMain()

      await wrapper.get('button[aria-label="Nap Mode"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(true)

      const ending = useLogStore(pinia).submit({
        kind: 'sleep.end',
        householdId: HOUSEHOLD_ID,
        entryId: 'sleep-nap-live',
        endAt: new Date().toISOString(),
        previousEndAt: null,
      })
      await settle()
      await ending

      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })
})
