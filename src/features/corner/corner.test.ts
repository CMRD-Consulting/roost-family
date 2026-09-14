import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { getDemoSnapshot, mutateDemo, resetDemoForTests } from '@/data/demo/demoHousehold'
import { LogWriteError } from '@/data/logWriter'
import MainScreen from '@/features/main/MainScreen.vue'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import * as sound from '@/ui/sound'
import { EXIT_PATTERN_RNG, seededRng } from './cornerExit'
import KidsCorner from './KidsCorner.vue'

vi.mock('@/data/householdSource', async () => {
  const { demoSource } = await import('@/data/demo/demoSource')
  return {
    isDemo: true,
    DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' },
    selectSource: async () => demoSource,
    selectWriter: async () => (await import('@/data/demo/demoLogWriter')).createDemoLogWriter(),
  }
})
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

const IVY = 'cccccccc-0000-0000-0000-000000000001'

let pinia: Pinia
let router: Router
let speakSpy: ReturnType<typeof vi.fn>

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

/** Holds a long-press target for `ms`. */
async function hold(el: Element, ms: number) {
  const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
  Object.defineProperties(down, { pointerId: { value: 1 }, pointerType: { value: 'touch' } })
  el.dispatchEvent(down)
  await vi.advanceTimersByTimeAsync(ms)
  await flushPromises()
}

/** Presses and lets go early. */
async function tapHold(el: Element, ms: number) {
  const opts = { bubbles: true, button: 0 }
  const down = new MouseEvent('pointerdown', opts)
  const up = new MouseEvent('pointerup', opts)
  for (const e of [down, up]) Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' } })
  el.dispatchEvent(down)
  await vi.advanceTimersByTimeAsync(ms)
  el.dispatchEvent(up)
  await flushPromises()
}

/** Lets the demo writer's simulated latency pass. */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
  await flushPromises()
}

const Shell = defineComponent({ render: () => h(RouterView) })

async function mountAt(path: string): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/home', component: MainScreen },
      { path: '/corner', component: KidsCorner },
      { path: '/removed', component: { render: () => null } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(Shell, {
    global: { plugins: [pinia, router], provide: { [EXIT_PATTERN_RNG as symbol]: seededRng(7) } },
    attachTo: document.body,
  })
  for (let i = 0; i < 10; i++) await flushPromises()
  return wrapper
}

/** Taps the exit pattern's numbered dots in the given order. */
async function tapDots(w: VueWrapper, order: number[]) {
  for (const n of order) {
    const dot = w.findAll('[role="dialog"] [data-testid="pattern-dot"]').find((d) => d.text() === String(n))
    if (!dot) throw new Error(`No pattern dot ${n}`)
    await dot.trigger('click')
  }
  await flushPromises()
}

const tab = (w: VueWrapper, name: string) => {
  const found = w.findAll('[role="tab"]').find((t) => t.text() === name)
  if (!found) throw new Error(`No tab "${name}"`)
  return found
}

describe("Kids' Corner (demo source)", () => {
  beforeEach(() => {
    resetDemoForTests()
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z')) // Monday 3:00 PM household time
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    speakSpy = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak: speakSpy, cancel: vi.fn() })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        rate = 1
        constructor(public text: string) {}
      },
    )
    vi.spyOn(sound, 'playChime').mockImplementation(() => {})
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(async () => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
    setOnline(true)
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    const { createOfflineQueue } = await import('@/data/offlineQueue')
    await createOfflineQueue().clear()
  })

  describe('child picker', () => {
    it('is skipped when exactly one child has Kids’ Corner (Ivy)', async () => {
      const wrapper = await mountAt('/corner')
      expect(wrapper.text()).not.toContain("Who's playing?")
      expect(wrapper.find('[data-testid="picture-schedule"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Done with Nap"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('asks who is playing when several children are eligible, and the avatar goes back to it', async () => {
      window.history.replaceState({}, '', '/corner?manyKids')
      const wrapper = await mountAt('/corner')
      expect(wrapper.text()).toContain("Who's playing?")
      // Ivy (3 y), Luna (2 y), Diego (4 y), Nora (6 y); Theo and Mateo are too young.
      expect(wrapper.findAll('[data-testid="corner-child"]').map((b) => b.attributes('aria-label'))).toEqual(['Ivy', 'Luna', 'Diego', 'Nora'])

      await wrapper.get('[data-testid="corner-child"][aria-label="Ivy"]').trigger('click')
      expect(wrapper.find('[data-testid="picture-schedule"]').exists()).toBe(true)

      await wrapper.get('button[aria-label="Switch child"]').trigger('click')
      expect(wrapper.text()).toContain("Who's playing?")
      wrapper.unmount()
    })

    it('shows a friendly empty state when no child has Kids’ Corner, still with the guarded exit', async () => {
      mutateDemo((s) => ({ ...s, children: s.children.map((c) => ({ ...c, overrides: { kidsCorner: false } })) }))
      const wrapper = await mountAt('/corner')
      expect(wrapper.find('[data-testid="corner-empty"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label^="Exit Kids"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  describe('picture schedule', () => {
    it('the big check completes the current step through the log store, celebrates, and advances', async () => {
      const wrapper = await mountAt('/corner')
      const submit = vi.spyOn(useLogStore(pinia), 'submit')

      await wrapper.get('button[aria-label="Done with Nap"]').trigger('click')
      await settle()

      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'routine.step', childId: IVY, routineId: 'routine-ivy-homeday', day: '2026-09-14', stepIndex: 5, done: true }),
      )
      expect(sound.playChime).toHaveBeenCalledTimes(1)
      expect(wrapper.find('button[aria-label="Done with Books"]').exists()).toBe(true)
      expect(getDemoSnapshot(new Date()).routineProgress[0]!.completed).toEqual([0, 1, 2, 5])
      wrapper.unmount()
    })

    it('ignores a second tap on the big check while the celebration runs, then accepts taps again', async () => {
      const wrapper = await mountAt('/corner')
      const submit = vi.spyOn(useLogStore(pinia), 'submit')

      await wrapper.get('button[aria-label="Done with Nap"]').trigger('click')
      // The optimistic view has already moved on to Books: a double tap must not finish it too.
      await wrapper.get('button[aria-label="Done with Books"]').trigger('click')
      await vi.advanceTimersByTimeAsync(600)
      await wrapper.get('button[aria-label="Done with Books"]').trigger('click')
      await settle()
      expect(submit).toHaveBeenCalledTimes(1)
      expect(sound.playChime).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(700)
      await wrapper.get('button[aria-label="Done with Books"]').trigger('click')
      await settle()
      expect(submit).toHaveBeenCalledTimes(2)
      expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'routine.step', stepIndex: 6, done: true }))
      wrapper.unmount()
    })

    it('shows "All done!" once the last step is finished', async () => {
      mutateDemo((s) => ({
        ...s,
        routineProgress: [{ ...s.routineProgress[0]!, completed: [0, 1, 2, 5, 6, 7] }],
      }))
      const wrapper = await mountAt('/corner')
      await wrapper.get('button[aria-label="Done with Bed"]').trigger('click')
      await settle()
      expect(wrapper.find('[data-testid="all-done"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label^="Done with"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tapping a step card says its label', async () => {
      const wrapper = await mountAt('/corner')
      await wrapper.get('[data-testid="step-card"][aria-label="Books"]').trigger('click')
      expect(speakSpy).toHaveBeenCalledTimes(1)
      expect(speakSpy.mock.calls[0]![0].text).toBe('Books')
      wrapper.unmount()
    })

    it('has a friendly empty state when there is no routine today', async () => {
      mutateDemo((s) => ({ ...s, routines: [] }))
      const wrapper = await mountAt('/corner')
      expect(wrapper.find('[data-testid="no-routine"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  describe('section tabs', () => {
    it('are a tablist whose tabs control one tabpanel, labelled by the selected tab', async () => {
      const wrapper = await mountAt('/corner')
      const list = wrapper.get('[role="tablist"]')
      expect(list.element.tagName).not.toBe('NAV')
      expect(list.attributes('aria-label')).toBe("Kids' Corner sections")
      const tabs = list.findAll('[role="tab"]')
      expect(tabs.map((t) => t.text())).toEqual(['Schedule', 'Timer', 'Stickers'])
      const panel = wrapper.get('[role="tabpanel"]')
      for (const t of tabs) expect(t.attributes('aria-controls')).toBe(panel.attributes('id'))
      expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false', 'false'])
      expect(tabs.map((t) => t.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
      expect(panel.attributes('aria-labelledby')).toBe(tabs[0]!.attributes('id'))
      expect(panel.find('[data-testid="picture-schedule"]').exists()).toBe(true)

      await tabs[2]!.trigger('click')
      expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(tabs[2]!.attributes('id'))
      expect(wrapper.get('[role="tabpanel"]').find('[data-testid="sticker-chart"]').exists()).toBe(true)
      expect(tabs.map((t) => t.attributes('tabindex'))).toEqual(['-1', '-1', '0'])
      wrapper.unmount()
    })

    it('arrow keys, Home and End move between tabs, selecting and focusing them', async () => {
      const wrapper = await mountAt('/corner')
      const tabs = () => wrapper.findAll('[role="tab"]')
      await tabs()[0]!.trigger('keydown', { key: 'ArrowRight' })
      expect(tabs()[1]!.attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs()[1]!.element)

      await tabs()[1]!.trigger('keydown', { key: 'End' })
      expect(tabs()[2]!.attributes('aria-selected')).toBe('true')
      await tabs()[2]!.trigger('keydown', { key: 'ArrowRight' })
      expect(tabs()[0]!.attributes('aria-selected')).toBe('true')
      await tabs()[0]!.trigger('keydown', { key: 'ArrowLeft' })
      expect(tabs()[2]!.attributes('aria-selected')).toBe('true')
      await tabs()[2]!.trigger('keydown', { key: 'Home' })
      expect(tabs()[0]!.attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs()[0]!.element)
      wrapper.unmount()
    })
  })

  describe('visual timer', () => {
    it('starts with a tap, chimes at zero and resets after 5 seconds', async () => {
      const wrapper = await mountAt('/corner')
      await tab(wrapper, 'Timer').trigger('click')
      await wrapper.get('button[aria-label="1 minute"]').trigger('click')

      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('running')
      expect(wrapper.get('[data-testid="timer-digits"]').text()).toBe('1:00')

      await vi.advanceTimersByTimeAsync(60_000)
      expect(sound.playChime).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('finished')

      await vi.advanceTimersByTimeAsync(5_000)
      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('idle')
      expect(wrapper.find('button[aria-label="1 minute"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('keeps running across tab switches and cancels only with a long-press', async () => {
      const wrapper = await mountAt('/corner')
      await tab(wrapper, 'Timer').trigger('click')
      await wrapper.get('button[aria-label="5 minutes"]').trigger('click')

      await tab(wrapper, 'Stickers').trigger('click')
      await vi.advanceTimersByTimeAsync(10_000)
      await tab(wrapper, 'Timer').trigger('click')
      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('running')

      const stop = wrapper.get('button[aria-label="Stop timer"]')
      await tapHold(stop.element, 200)
      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('running')

      await hold(stop.element, 600)
      expect(wrapper.get('[data-testid="timer-disc"]').attributes('data-phase')).toBe('idle')
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(sound.playChime).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  describe('sticker chart', () => {
    it("shows this week's stickers per category with today's column highlighted", async () => {
      const wrapper = await mountAt('/corner')
      await tab(wrapper, 'Stickers').trigger('click')
      const rows = wrapper.findAll('[data-testid="sticker-row"]')
      expect(rows.map((r) => r.get('th').text())).toEqual(['Potty', 'Teeth', 'Tried a new food'])
      const potty = rows[0]!.findAll('[data-testid="sticker-cell"]')
      expect(potty).toHaveLength(7)
      expect(potty[0]!.findAll('[data-testid="sticker"]')).toHaveLength(1)
      expect(potty[0]!.attributes('data-today')).toBe('true')
      expect(potty[1]!.attributes('data-today')).toBeUndefined()
      expect(wrapper.find('[data-testid="sticker-chart"] button').exists()).toBe(false)
      wrapper.unmount()
    })

    it('is a real table: day column headers, category row headers, and a spoken count in each cell', async () => {
      const wrapper = await mountAt('/corner')
      await tab(wrapper, 'Stickers').trigger('click')
      const table = wrapper.get('[data-testid="sticker-chart"] table')
      expect(table.find('caption').text()).toBe('Sticker chart')
      const columnHeaders = table.findAll('thead th[scope="col"]')
      expect(columnHeaders.map((h) => h.text())).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
      expect(table.findAll('tbody tr')).toHaveLength(3)
      expect(table.findAll('tbody th[scope="row"]').map((h) => h.text())).toEqual(['Potty', 'Teeth', 'Tried a new food'])
      const firstRowCells = table.findAll('tbody tr')[0]!.findAll('td')
      expect(firstRowCells).toHaveLength(7)
      expect(firstRowCells[0]!.text()).toBe('1 sticker')
      expect(firstRowCells[1]!.text()).toBe('0 stickers')
      // No ARIA table roles layered over the native table.
      expect(wrapper.find('[data-testid="sticker-chart"] [role]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('shows up to five stars, then "+N"', async () => {
      mutateDemo((s) => ({
        ...s,
        stickers: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, childId: IVY, categoryId: s.stickerCategories[0]!.id, at: '2026-09-14T14:00:00Z', sitterSessionId: null })),
      }))
      const wrapper = await mountAt('/corner')
      await tab(wrapper, 'Stickers').trigger('click')
      const cell = wrapper.findAll('[data-testid="sticker-row"]')[0]!.findAll('[data-testid="sticker-cell"]')[0]!
      expect(cell.findAll('[data-testid="sticker"]')).toHaveLength(5)
      expect(cell.text()).toContain('+2')
      wrapper.unmount()
    })
  })

  describe('exit', () => {
    it('needs a 2 second hold and then an adult PIN to go back to the main screen', async () => {
      const wrapper = await mountAt('/corner')
      const lock = wrapper.get('button[aria-label^="Exit Kids"]')

      await tapHold(lock.element, 1_000)
      expect(document.querySelector('[role="dialog"]')).toBeNull()

      await hold(lock.element, 2_000)
      const dialog = wrapper.get('[role="dialog"]')
      await dialog.get(`button[aria-label="Sam"]`).trigger('click')
      for (const digit of ['1', '2', '3', '4']) await wrapper.get(`[role="dialog"] button[aria-label="${digit}"]`).trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/home')
      wrapper.unmount()
    })

    it('a wrong PIN keeps the Corner', async () => {
      const wrapper = await mountAt('/corner')
      await hold(wrapper.get('button[aria-label^="Exit Kids"]').element, 2_000)
      await wrapper.get('[role="dialog"] button[aria-label="Sam"]').trigger('click')
      for (const digit of ['9', '9', '9', '9']) await wrapper.get(`[role="dialog"] button[aria-label="${digit}"]`).trigger('click')
      await flushPromises()
      expect(wrapper.get('[role="dialog"]').text()).toContain("That PIN didn't match.")
      expect(router.currentRoute.value.path).toBe('/corner')
      wrapper.unmount()
    })

    it('offline, a numbered-dot pattern replaces the PIN so the tablet is never trapped', async () => {
      const wrapper = await mountAt('/corner')
      setOnline(false)
      await flushPromises()

      await hold(wrapper.get('button[aria-label^="Exit Kids"]').element, 2_000)
      const dialog = wrapper.get('[role="dialog"]')
      expect(dialog.find('[data-keypad]').exists()).toBe(false)
      const instruction = dialog.get('[data-testid="pattern-instruction"]')
      expect(instruction.text()).toBe('Adults: tap 1, 2, 3, 4 in order')
      expect(instruction.classes()).toContain('text-[22px]')
      // Seeded positions (see mountAt): the numbers are visible text on dots scattered around the area.
      const dots = dialog.findAll('[data-testid="pattern-dot"]')
      expect(dots.map((d) => d.text()).sort()).toEqual(['1', '2', '3', '4'])
      const positions = dots.map((d) => d.attributes('style'))
      expect(new Set(positions).size).toBe(4)

      await tapDots(wrapper, [1, 2, 3, 4])
      expect(router.currentRoute.value.path).toBe('/home')
      wrapper.unmount()
    })

    it('the pattern resets on a tap out of order, and after 10 seconds', async () => {
      const wrapper = await mountAt('/corner')
      setOnline(false)
      await flushPromises()
      await hold(wrapper.get('button[aria-label^="Exit Kids"]').element, 2_000)

      await tapDots(wrapper, [1, 2, 4, 3])
      expect(wrapper.findAll('[data-testid="pattern-dot"][data-tapped]')).toHaveLength(0)
      expect(router.currentRoute.value.path).toBe('/corner')

      await tapDots(wrapper, [1, 2, 3])
      expect(wrapper.findAll('[data-testid="pattern-dot"][data-tapped]')).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(10_001)
      expect(wrapper.findAll('[data-testid="pattern-dot"][data-tapped]')).toHaveLength(0)
      await tapDots(wrapper, [4])
      expect(router.currentRoute.value.path).toBe('/corner')

      await tapDots(wrapper, [1, 2, 3, 4])
      expect(router.currentRoute.value.path).toBe('/home')
      wrapper.unmount()
    })

    it('falls back to the pattern when the PIN check fails for lack of a connection', async () => {
      const wrapper = await mountAt('/corner')
      vi.spyOn(useLogStore(pinia), 'verifyPin').mockRejectedValue(new LogWriteError('offline', true, null))
      await hold(wrapper.get('button[aria-label^="Exit Kids"]').element, 2_000)
      await wrapper.get('[role="dialog"] button[aria-label="Sam"]').trigger('click')
      for (const digit of ['1', '2', '3', '4']) await wrapper.get(`[role="dialog"] button[aria-label="${digit}"]`).trigger('click')
      await flushPromises()
      expect(wrapper.find('[role="dialog"] [data-testid="pattern-instruction"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('history back from the Corner is cancelled', async () => {
      const wrapper = await mountAt('/home')
      await wrapper.get('button[aria-label="Kids\' Corner"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/corner')

      router.back()
      for (let i = 0; i < 5; i++) await flushPromises()
      expect(router.currentRoute.value.path).toBe('/corner')
      expect(wrapper.find('[data-testid="picture-schedule"]').exists()).toBe(true)

      await router.push('/home')
      expect(router.currentRoute.value.path).toBe('/corner')
      wrapper.unmount()
    })

    it('still leaves when the display is removed', async () => {
      const wrapper = await mountAt('/corner')
      useDisplayStore(pinia).state = { kind: 'revoked' }
      for (let i = 0; i < 5; i++) await flushPromises()
      expect(router.currentRoute.value.path).toBe('/removed')
      wrapper.unmount()
    })
  })

  describe('household session', () => {
    it('going from the main screen to the Corner keeps the household loaded, without restarting it', async () => {
      const store = useHouseholdStore(pinia)
      const start = vi.spyOn(store, 'start')
      const wrapper = await mountAt('/home')
      expect(start).toHaveBeenCalledTimes(1)

      await wrapper.get('button[aria-label="Kids\' Corner"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/corner')
      expect(store.snapshot).not.toBeNull()
      for (let i = 0; i < 5; i++) await flushPromises()
      expect(wrapper.find('[data-testid="picture-schedule"]').exists()).toBe(true)
      expect(start).toHaveBeenCalledTimes(1)
      expect(store.snapshot).not.toBeNull()

      // Logging still works after the handover.
      await wrapper.get('button[aria-label="Done with Nap"]').trigger('click')
      await settle()
      expect(wrapper.find('button[aria-label="Done with Books"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  describe('Night and Nap Mode', () => {
    it('shows the Night screen in the Corner too, and a tap peeks', async () => {
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z')) // 10 PM household time
      const wrapper = await mountAt('/corner')
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="picture-schedule"]').exists()).toBe(false)

      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      expect(wrapper.find('[data-testid="night-peek-chip"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('an exit PIN pad open at the night boundary stays open; Night Mode starts once it closes', async () => {
      vi.setSystemTime(new Date('2026-09-14T23:59:00Z')) // 7:59 PM household time
      const wrapper = await mountAt('/corner')
      await hold(wrapper.get('button[aria-label^="Exit Kids"]').element, 2_000)
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)

      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('a tap in the Corner during a peek restarts the 60 second peek', async () => {
      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
      const wrapper = await mountAt('/corner')
      await wrapper.get('[data-testid="night-screen"]').trigger('click')
      await vi.advanceTimersByTimeAsync(50_000)
      wrapper.get('[data-testid="picture-schedule"]').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(50_000)
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="night-peek-chip"]').text()).toBe('Night Mode · back in 0:10')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(wrapper.find('[data-testid="night-screen"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('shows the Nap overlay while napping', async () => {
      localStorage.setItem('roost-nap', JSON.stringify({ startedAt: new Date().toISOString(), openSleepIds: [] }))
      const wrapper = await mountAt('/corner')
      expect(wrapper.find('[data-testid="nap-overlay"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })
})
