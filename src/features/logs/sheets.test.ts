import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSource } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import { LogWriteError } from '@/data/logWriter'
import type { HouseholdSnapshot } from '@/data/snapshot'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import DiaperSheet from './DiaperSheet.vue'
import DinnerSheet from './DinnerSheet.vue'
import FeedingSheet from './FeedingSheet.vue'
import GrocerySheet from './GrocerySheet.vue'
import JotSheet from './JotSheet.vue'
import SleepSheet from './SleepSheet.vue'
import StaleSleepSheet from './StaleSleepSheet.vue'
import StickerSheet from './StickerSheet.vue'
import { button, checked, click, createFakeQueue, createFakeWriter, radio, type FakeWriter } from './sheetTestHelpers'

vi.mock('@/ui/sound', () => ({ playChime: vi.fn(), unlockAudio: vi.fn(), setMuted: vi.fn() }))
import { playChime } from '@/ui/sound'

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'

let pinia: Pinia
let writer: FakeWriter
let wrapper: VueWrapper | null = null
/** What the (fake) server returns on the next load; tests change it and call `useHouseholdStore().reload()`. */
let serverSnapshot: HouseholdSnapshot

async function setup(nowIso: string, mutate: (s: HouseholdSnapshot) => void = () => {}) {
  vi.setSystemTime(new Date(nowIso))
  pinia = createPinia()
  setActivePinia(pinia)
  const snapshot = buildDemoSnapshot(new Date(nowIso))
  mutate(snapshot)
  serverSnapshot = snapshot
  const source: HouseholdSource = { load: async () => structuredClone(serverSnapshot), subscribe: () => () => {} }
  await useHouseholdStore().start(HOUSEHOLD_ID, source)
  writer = createFakeWriter()
  await useLogStore().init(writer, createFakeQueue())
  useDisplayStore().state = {
    kind: 'registered',
    identity: { displayId: 'display-1', householdId: HOUSEHOLD_ID, name: 'Kitchen' },
  }
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function reopen(w: VueWrapper) {
  await w.setProps({ open: false })
  await flushPromises()
  await w.setProps({ open: true })
  await flushPromises()
}

const footerButton = (w: VueWrapper) => w.get('[role="dialog"] .sticky button')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountSheet(component: any, props: Record<string, unknown> = {}): VueWrapper {
  wrapper = mount(component, { props: { open: true, ...props }, global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

describe('log sheets', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.mocked(playChime).mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    setOnline(true)
    useHouseholdStore().stop()
    useLogStore().stop()
    vi.useRealTimers()
  })

  describe('SleepSheet', () => {
    it('starts a sleep for the only eligible child with an auto type that follows the time until changed', async () => {
      await setup('2026-09-14T22:30:00Z') // 6:30 PM in New York; Theo's window is 6 PM–5 AM
      const w = mountSheet(SleepSheet)
      await flushPromises()

      expect(checked(w, 'Child').join()).toContain('Theo')
      expect(w.get('[aria-label="Child"]').text()).not.toContain('Ivy') // 3 y, no recent sleep
      expect(checked(w, 'Sleep type')).toEqual(['Night'])

      for (let i = 0; i < 7; i++) await click(button(w, '−5 min')) // 5:55 PM
      expect(checked(w, 'Sleep type')).toEqual(['Nap'])

      await click(radio(w, 'Sleep type', 'Night')) // adult override sticks
      await click(button(w, '−5 min')) // 5:50 PM would auto-classify as Nap
      expect(checked(w, 'Sleep type')).toEqual(['Night'])

      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, 'Start sleep'))

      expect(writer.calls).toHaveLength(1)
      const cmd = writer.calls[0]!
      expect(cmd.kind).toBe('sleep.start')
      if (cmd.kind !== 'sleep.start') return
      expect(cmd.entry).toMatchObject({ childId: THEO, startAt: '2026-09-14T21:50:00.000Z', endAt: null, type: 'night' })
      expect(cmd.attribution).toEqual({ displayId: 'display-1', loggedByMembershipId: SAM, sitterSessionId: null, loggedByName: 'Sam' })
      expect(w.emitted('saved')).toEqual([['saved']])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('ends the open sleep', async () => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        s.sleeps.push({ id: 'open-theo', childId: THEO, startAt: '2026-09-14T18:30:00.000Z', endAt: null, type: 'nap' })
      })
      const w = mountSheet(SleepSheet)
      await flushPromises()

      expect(w.text()).toContain('Sleeping since 2:30 PM')
      await click(button(w, '−5 min'))
      await click(button(w, 'End sleep'))

      expect(writer.calls).toEqual([
        { kind: 'sleep.end', householdId: HOUSEHOLD_ID, entryId: 'open-theo', endAt: '2026-09-14T18:55:00.000Z', previousEndAt: null },
      ])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('reopening after ending a sleep (and a reload that confirms it) offers Start sleep', async () => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        s.sleeps.push({ id: 'open-theo', childId: THEO, startAt: '2026-09-14T18:30:00.000Z', endAt: null, type: 'nap' })
      })
      const w = mountSheet(SleepSheet)
      await flushPromises()
      await click(button(w, 'End sleep'))
      expect(w.find('[data-testid="sleep-mode-notice"]').exists()).toBe(false) // its own save isn't "another display"

      await w.setProps({ open: false })
      serverSnapshot.sleeps = serverSnapshot.sleeps.map((s) => (s.id === 'open-theo' ? { ...s, endAt: '2026-09-14T19:00:00.000Z' } : s))
      await useHouseholdStore().reload()
      await flushPromises()
      await w.setProps({ open: true })
      await flushPromises()

      expect(footerButton(w).text()).toBe('Start sleep')
      expect(w.text()).not.toContain('Sleeping since')
      expect(w.find('[data-testid="sleep-mode-notice"]').exists()).toBe(false)
    })

    it('reopening after starting a sleep offline offers End sleep', async () => {
      await setup('2026-09-14T19:00:00Z')
      setOnline(false)
      const w = mountSheet(SleepSheet)
      await flushPromises()
      await click(button(w, 'Start sleep'))
      expect(useLogStore().pendingCount).toBe(1)

      await reopen(w)

      expect(footerButton(w).text()).toBe('End sleep')
      expect(w.text()).toContain('Sleeping since 3:00 PM')
    })

    it('an open sleep arriving from another display while the sheet is open is announced, re-clamps the time and needs a fresh tap', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(SleepSheet)
      await flushPromises()
      for (let i = 0; i < 6; i++) await click(button(w, '−5 min')) // 2:30 PM
      expect(footerButton(w).text()).toBe('Start sleep')

      serverSnapshot.sleeps.push({ id: 'other-display', childId: THEO, startAt: '2026-09-14T18:50:00.000Z', endAt: null, type: 'nap' })
      await useHouseholdStore().reload()
      await flushPromises()

      const notice = w.get('[data-testid="sleep-mode-notice"]')
      expect(notice.text()).toBe("Another display just updated Theo's sleep.")
      expect(notice.classes()).toContain('text-[18px]')
      expect(footerButton(w).text()).toBe('End sleep')
      expect(w.text()).toContain('Sleeping since 2:50 PM')
      expect(w.text()).toContain('2:50 PM') // woke-up time pulled up to the sleep's start

      await click(footerButton(w)) // a tap meant for "Start sleep" doesn't end the other display's sleep
      expect(writer.calls).toEqual([])
      await click(footerButton(w))
      expect(writer.calls).toEqual([
        { kind: 'sleep.end', householdId: HOUSEHOLD_ID, entryId: 'other-display', endAt: '2026-09-14T18:50:00.000Z', previousEndAt: null },
      ])
    })

    it('an open sleep ended by another display while the sheet is open flips to Start sleep with a notice', async () => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        s.sleeps.push({ id: 'open-theo', childId: THEO, startAt: '2026-09-14T18:30:00.000Z', endAt: null, type: 'nap' })
      })
      const w = mountSheet(SleepSheet)
      await flushPromises()
      expect(footerButton(w).text()).toBe('End sleep')

      serverSnapshot.sleeps = serverSnapshot.sleeps.map((s) => (s.id === 'open-theo' ? { ...s, endAt: '2026-09-14T18:55:00.000Z' } : s))
      await useHouseholdStore().reload()
      await flushPromises()

      expect(w.get('[data-testid="sleep-mode-notice"]').text()).toBe("Another display just updated Theo's sleep.")
      expect(footerButton(w).text()).toBe('Start sleep')
      await click(footerButton(w))
      expect(writer.calls).toEqual([])
      await click(footerButton(w))
      expect(writer.calls[0]?.kind).toBe('sleep.start')
    })

    it('shows a save error inline and stays open', async () => {
      await setup('2026-09-14T19:00:00Z')
      writer.failNextWith = new LogWriteError('check constraint', false, '23514')
      const w = mountSheet(SleepSheet)
      await flushPromises()

      await click(button(w, 'Start sleep'))
      expect(w.get('[role="alert"]').text()).toBe("Couldn't save that. Please try again.")
      expect(w.emitted('close')).toBeUndefined()
    })
  })

  describe('time field follows the clock until adjusted', () => {
    const cases: [string, unknown, (w: VueWrapper) => Promise<void>, string, (c: LogCommand) => string | undefined][] = [
      ['SleepSheet', SleepSheet, async () => {}, 'Start sleep', (c) => (c.kind === 'sleep.start' ? c.entry.startAt : undefined)],
      ['FeedingSheet', FeedingSheet, (w) => click(radio(w, 'Feeding type', 'Milk')), 'Save', (c) => (c.kind === 'feeding.add' ? c.entry.at : undefined)],
      ['DiaperSheet', DiaperSheet, async (w) => { await click(radio(w, 'Child', 'Theo')); await click(radio(w, 'Diaper', 'Wet')) }, 'Save', (c) => (c.kind === 'diaper.add' ? c.entry.at : undefined)],
      ['StickerSheet', StickerSheet, (w) => click(radio(w, 'Sticker category', 'Teeth')), 'Give sticker', (c) => (c.kind === 'sticker.add' ? c.entry.at : undefined)],
    ]

    it.each(cases)('%s saves the current time after the sheet sat open for 25 minutes', async (_name, component, fill, save, atOf) => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        s.household.diaperLogEnabled = true
      })
      const w = mountSheet(component)
      await flushPromises()
      await fill(w)

      vi.advanceTimersByTime(25 * 60_000)
      await flushPromises()
      await click(button(w, save))

      expect(writer.calls.map(atOf)).toEqual(['2026-09-14T19:25:00.000Z'])
    })

    it('a stepped time stays put', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(FeedingSheet)
      await flushPromises()
      await click(radio(w, 'Feeding type', 'Milk'))
      await click(button(w, '−5 min'))

      vi.advanceTimersByTime(25 * 60_000)
      await flushPromises()
      await click(button(w, 'Save'))

      expect(writer.calls[0]?.kind === 'feeding.add' && writer.calls[0].entry.at).toBe('2026-09-14T18:55:00.000Z')
    })
  })

  describe('FeedingSheet', () => {
    it('switches amount chips with the type, clears an amount on second tap, and saves', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(FeedingSheet)
      await flushPromises()

      expect(button(w, 'Save').attributes('disabled')).toBeDefined()
      expect(w.find('[aria-label="Amount"]').exists()).toBe(false)

      await click(radio(w, 'Feeding type', 'Milk'))
      expect(w.get('[aria-label="Amount"]').findAll('[role="radio"]').map((r) => r.text())).toEqual(['2 oz', '4 oz', '6 oz', '8 oz'])
      await click(radio(w, 'Amount', '4 oz'))

      await click(radio(w, 'Feeding type', 'Meal'))
      expect(w.get('[aria-label="Amount"]').findAll('[role="radio"]').map((r) => r.text())).toEqual(['A little', 'Some', 'All'])
      expect(checked(w, 'Amount')).toEqual([])

      await click(radio(w, 'Amount', 'Some'))
      await click(radio(w, 'Amount', 'Some'))
      expect(checked(w, 'Amount')).toEqual([])
      await click(radio(w, 'Amount', 'All'))

      await w.get('input').setValue('  loved the peas  ')
      await click(button(w, 'Save'))

      const cmd = writer.calls[0]!
      expect(cmd.kind).toBe('feeding.add')
      if (cmd.kind !== 'feeding.add') return
      expect(cmd.entry).toMatchObject({ childId: THEO, type: 'meal', amount: 'All', note: 'loved the peas', at: '2026-09-14T19:00:00.000Z' })
      expect(cmd.attribution.loggedByMembershipId).toBeNull()
      expect(cmd.attribution.displayId).toBe('display-1')
      expect(w.emitted('close')).toHaveLength(1)
    })
  })

  describe('DiaperSheet', () => {
    it('requires a child pick when several are eligible, and a kind', async () => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        s.household.diaperLogEnabled = true
      })
      const w = mountSheet(DiaperSheet)
      await flushPromises()

      expect(checked(w, 'Child')).toEqual([])
      expect(button(w, 'Save').attributes('disabled')).toBeDefined()
      await click(radio(w, 'Child', 'Ivy'))
      expect(button(w, 'Save').attributes('disabled')).toBeDefined()
      await click(radio(w, 'Diaper', 'Both'))
      await click(button(w, 'Save'))

      const cmd = writer.calls[0]!
      expect(cmd.kind === 'diaper.add' && cmd.entry).toMatchObject({ childId: IVY, kind: 'both' })
    })
  })

  describe('StickerSheet', () => {
    it("celebrates the child's sticker, then reports saved and closes", async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(StickerSheet)
      await flushPromises()

      expect(checked(w, 'Child').join()).toContain('Ivy') // the only child in the sticker age range
      await click(radio(w, 'Sticker category', 'Teeth'))
      await click(button(w, 'Give sticker'))

      const cmd = writer.calls[0]!
      expect(cmd.kind === 'sticker.add' && cmd.entry).toMatchObject({ childId: IVY, categoryId: 'dddddddd-0000-0000-0000-000000000002' })
      const celebration = w.get('[data-testid="sticker-celebration"]')
      expect(celebration.text()).toContain('Sticker for Ivy!')
      expect(playChime).toHaveBeenCalledTimes(1)
      expect(w.find('[role="dialog"]').exists()).toBe(false)
      expect(w.emitted('saved')).toBeUndefined()

      vi.advanceTimersByTime(1_800)
      await flushPromises()
      expect(w.emitted('saved')).toEqual([['saved']])
      expect(w.emitted('close')).toHaveLength(1)
    })
  })

  describe('StickerSheet and the undo window', () => {
    async function giveSticker() {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(StickerSheet)
      await flushPromises()
      await click(radio(w, 'Sticker category', 'Teeth'))
      await click(button(w, 'Give sticker'))
      return w
    }

    it('the undo window restarts with a full 10 seconds when the celebration ends on its own', async () => {
      const w = await giveSticker()
      const logStore = useLogStore()
      expect(logStore.lastAction?.command.kind).toBe('sticker.add')

      vi.advanceTimersByTime(1_800)
      await flushPromises()
      expect(w.find('[data-testid="sticker-celebration"]').exists()).toBe(false)

      vi.advanceTimersByTime(9_900)
      expect(logStore.lastAction?.command.kind).toBe('sticker.add')
      vi.advanceTimersByTime(100)
      expect(logStore.lastAction).toBeNull()
    })

    it('a tap dismisses the celebration without undoing, and the full undo window starts then', async () => {
      const w = await giveSticker()
      const logStore = useLogStore()
      vi.advanceTimersByTime(500)

      await click(w.get('[data-testid="sticker-celebration"]'))
      expect(w.find('[data-testid="sticker-celebration"]').exists()).toBe(false)
      expect(w.emitted('close')).toHaveLength(1)
      expect(writer.calls.map((c) => c.kind)).toEqual(['sticker.add']) // nothing undone

      vi.advanceTimersByTime(9_900)
      expect(logStore.lastAction?.command.kind).toBe('sticker.add')
      vi.advanceTimersByTime(100)
      expect(logStore.lastAction).toBeNull()
    })
  })

  describe('Sitter Mode attribution', () => {
    const SESSION = 'session-jess'
    const sitter = (s: HouseholdSnapshot) => {
      s.household.diaperLogEnabled = true
      s.activeSitterSession = { id: SESSION, sitterName: 'Jess', startedAt: '2026-09-14T17:00:00.000Z', endedAt: null, summaryShownAt: null }
    }
    const SITTER_ATTRIBUTION = { displayId: 'display-1', loggedByMembershipId: null, sitterSessionId: SESSION, loggedByName: 'Jess (sitter)' }
    const attributionOf = (cmd: LogCommand | undefined) => (cmd && 'attribution' in cmd ? cmd.attribution : null)
    const expectSitterLine = (w: VueWrapper) => {
      expect(w.find('[aria-label="Who"]').exists()).toBe(false)
      const line = w.get('[data-testid="sitter-who"]')
      expect(line.text()).toBe('Logged by Jess (sitter)')
      expect(line.classes()).toContain('text-[18px]')
    }

    it('sleep', async () => {
      await setup('2026-09-14T19:00:00Z', sitter)
      const w = mountSheet(SleepSheet)
      await flushPromises()
      expectSitterLine(w)
      await click(button(w, 'Start sleep'))
      expect(attributionOf(writer.calls[0])).toEqual(SITTER_ATTRIBUTION)
    })

    it('feeding', async () => {
      await setup('2026-09-14T19:00:00Z', sitter)
      const w = mountSheet(FeedingSheet)
      await flushPromises()
      await click(radio(w, 'Feeding type', 'Milk'))
      expectSitterLine(w)
      await click(button(w, 'Save'))
      expect(attributionOf(writer.calls[0])).toEqual(SITTER_ATTRIBUTION)
    })

    it('sticker', async () => {
      await setup('2026-09-14T19:00:00Z', sitter)
      const w = mountSheet(StickerSheet)
      await flushPromises()
      await click(radio(w, 'Sticker category', 'Teeth'))
      expectSitterLine(w)
      await click(button(w, 'Give sticker'))
      expect(attributionOf(writer.calls[0])).toEqual(SITTER_ATTRIBUTION)
    })

    it('diaper', async () => {
      await setup('2026-09-14T19:00:00Z', sitter)
      const w = mountSheet(DiaperSheet)
      await flushPromises()
      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Diaper', 'Wet'))
      expectSitterLine(w)
      await click(button(w, 'Save'))
      expect(attributionOf(writer.calls[0])).toEqual(SITTER_ATTRIBUTION)
    })

    it('says "Sitter" for a sitter without a name', async () => {
      await setup('2026-09-14T19:00:00Z', (s) => {
        sitter(s)
        s.activeSitterSession!.sitterName = null
      })
      const w = mountSheet(FeedingSheet)
      await flushPromises()
      await click(radio(w, 'Feeding type', 'Milk'))
      expect(w.get('[data-testid="sitter-who"]').text()).toBe('Logged by Sitter')
      await click(button(w, 'Save'))
      expect(attributionOf(writer.calls[0])).toMatchObject({ sitterSessionId: SESSION, loggedByName: 'Sitter' })
    })

    it('the Who row returns once the session has ended', async () => {
      await setup('2026-09-14T19:00:00Z', sitter)
      const w = mountSheet(FeedingSheet)
      await flushPromises()
      await click(radio(w, 'Feeding type', 'Milk'))
      expectSitterLine(w)

      serverSnapshot.activeSitterSession = null
      await useHouseholdStore().reload()
      await flushPromises()

      expect(w.find('[data-testid="sitter-who"]').exists()).toBe(false)
      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, 'Save'))
      expect(attributionOf(writer.calls[0])).toEqual({ displayId: 'display-1', loggedByMembershipId: SAM, sitterSessionId: null, loggedByName: 'Sam' })
    })
  })

  describe('JotSheet', () => {
    it('saves trimmed text attributed to the display', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(JotSheet)
      await flushPromises()

      const textarea = w.get('textarea')
      expect((textarea.element as HTMLTextAreaElement).labels![0]!.textContent).toBe('What do you want to remember?')
      expect(button(w, 'Save').attributes('disabled')).toBeDefined()
      await textarea.setValue('  Buy a birthday card  ')
      await click(button(w, 'Save'))

      const cmd = writer.calls[0]!
      expect(cmd.kind === 'jot.add' && cmd).toMatchObject({ jot: { text: 'Buy a birthday card', doneAt: null }, displayId: 'display-1' })
      expect(w.emitted('close')).toHaveLength(1)
    })
  })

  describe('GrocerySheet', () => {
    it('adds, checks and deletes items while staying open', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(GrocerySheet)
      await flushPromises()
      const names = () => w.findAll('[data-testid="grocery-item"]').map((li) => li.get('[role="checkbox"] > span:last-child').text())

      expect(names()).toEqual(['Whole milk', 'Bananas'])
      expect(button(w, 'Take list').attributes('disabled')).toBeDefined()
      expect(w.text()).toContain('Coming soon')

      await w.get('input').setValue('   ')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(writer.calls).toEqual([])

      await w.get('input').setValue('  Eggs ')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(writer.calls[0]).toMatchObject({ kind: 'grocery.add', item: { text: 'Eggs', checkedAt: null }, displayId: 'display-1' })
      expect((w.get('input').element as HTMLInputElement).value).toBe('')
      expect(names()).toEqual(['Whole milk', 'Bananas', 'Eggs'])

      const milk = w.findAll('[role="checkbox"]').find((b) => b.text().endsWith('Whole milk'))!
      await click(milk)
      expect(writer.calls[1]).toMatchObject({ kind: 'grocery.check', itemId: 'grocery-1', checkedAt: '2026-09-14T19:00:00.000Z', previousCheckedAt: null })
      expect(names()).toEqual(['Bananas', 'Eggs', 'Whole milk'])
      expect(w.findAll('[role="checkbox"]').find((b) => b.text().endsWith('Whole milk'))!.attributes('aria-checked')).toBe('true')

      await click(w.get('button[aria-label="Remove Bananas"]'))
      expect(writer.calls[2]).toMatchObject({ kind: 'grocery.delete', item: { id: 'grocery-2' } })
      expect(names()).toEqual(['Eggs', 'Whole milk'])

      expect(w.emitted('saved')).toHaveLength(3)
      expect(w.emitted('close')).toBeUndefined()
    })
  })

  describe('StaleSleepSheet', () => {
    const staleIvy = (s: HouseholdSnapshot) => {
      s.sleeps.push({ id: 'stale-ivy', childId: IVY, startAt: '2026-09-14T00:02:00.000Z', endAt: null, type: 'night' })
    }

    it('ends the forgotten sleep at the chosen time', async () => {
      await setup('2026-09-14T19:00:00Z', staleIvy)
      const w = mountSheet(StaleSleepSheet, { childId: IVY })
      await flushPromises()

      expect(w.text()).toContain("Ivy's sleep started at 8:02 PM yesterday and was never ended.")
      await click(button(w, 'End sleep'))
      expect(writer.calls).toEqual([
        { kind: 'sleep.end', householdId: HOUSEHOLD_ID, entryId: 'stale-ivy', endAt: '2026-09-14T19:00:00.000Z', previousEndAt: null },
      ])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('discards only after confirming', async () => {
      await setup('2026-09-14T19:00:00Z', staleIvy)
      const w = mountSheet(StaleSleepSheet, { childId: IVY })
      await flushPromises()

      await click(button(w, 'Discard this sleep'))
      expect(w.text()).toContain('Discard? This removes the sleep log.')
      expect(writer.calls).toEqual([])
      await click(button(w, 'Keep it'))
      expect(w.text()).toContain('was never ended')

      await click(button(w, 'Discard this sleep'))
      await click(button(w, 'Discard'))
      expect(writer.calls[0]).toMatchObject({ kind: 'sleep.discard', entry: { id: 'stale-ivy' }, attribution: { displayId: 'display-1' } })
      expect(w.emitted('close')).toHaveLength(1)
    })
  })

  describe('DinnerSheet', () => {
    it("prefills tonight's dinner and saves a new one", async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(DinnerSheet)
      await flushPromises()

      const input = w.get('input')
      expect((input.element as HTMLInputElement).value).toBe('Tacos')
      expect(button(w, 'Save').attributes('disabled')).toBeDefined() // unchanged
      await input.setValue(' Pizza ')
      await click(button(w, 'Save'))
      expect(writer.calls).toEqual([{ kind: 'dinner.set', householdId: HOUSEHOLD_ID, text: 'Pizza', previous: 'Tacos' }])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('clears the dinner', async () => {
      await setup('2026-09-14T19:00:00Z')
      const w = mountSheet(DinnerSheet)
      await flushPromises()

      await click(button(w, 'Clear'))
      expect(writer.calls).toEqual([{ kind: 'dinner.set', householdId: HOUSEHOLD_ID, text: null, previous: 'Tacos' }])
    })
  })
})
