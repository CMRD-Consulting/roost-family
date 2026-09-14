import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSource } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import type { HouseholdSnapshot } from '@/data/snapshot'
import { LogWriteError } from '@/data/logWriter'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import DosePinDialog from './DosePinDialog.vue'
import MedicineSheet from './MedicineSheet.vue'
import { button, checked, click, createFakeQueue, createFakeWriter, radio, type FakeWriter } from './sheetTestHelpers'

const NOW = '2026-09-14T19:00:00Z' // 3:00 PM in New York; the demo ibuprofen dose was at 1:00 PM by Sam
const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'
const IBUPROFEN_THEO = 'eeeeeeee-0000-0000-0000-000000000001'
const ACETAMINOPHEN_THEO = 'eeeeeeee-0000-0000-0000-000000000002'
const CONFLICT_DOSE = 'ffffffff-0000-0000-0000-000000000002'

let pinia: Pinia
let writer: FakeWriter
/** What the (fake) server returns on the next load; tests change it and call `useHouseholdStore().reload()`. */
let serverSnapshot: HouseholdSnapshot
let wrapper: VueWrapper | null = null

async function setup(opts: { realtime?: 'connected' | null; conflict?: boolean; sitter?: boolean } = {}) {
  vi.setSystemTime(new Date(NOW))
  pinia = createPinia()
  setActivePinia(pinia)
  const snapshot = buildDemoSnapshot(new Date(NOW), { conflict: opts.conflict, sitter: opts.sitter })
  serverSnapshot = snapshot
  const realtime = opts.realtime === undefined ? 'connected' : opts.realtime
  const source: HouseholdSource = {
    load: async () => structuredClone(serverSnapshot),
    subscribe: (_id, _onChange, onStatus) => {
      if (realtime) onStatus?.(realtime)
      return () => {}
    },
  }
  await useHouseholdStore().start(HOUSEHOLD_ID, source)
  writer = createFakeWriter()
  writer.verifyPin = async (_membershipId, pin) => pin === '1234'
  await useLogStore().init(writer, createFakeQueue())
  useDisplayStore().state = {
    kind: 'registered',
    identity: { displayId: 'display-1', householdId: HOUSEHOLD_ID, name: 'Kitchen' },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountIt(component: any, props: Record<string, unknown> = {}): VueWrapper {
  wrapper = mount(component, { props: { open: true, ...props }, global: { plugins: [pinia] }, attachTo: document.body })
  return wrapper
}

function lastDose(): Extract<LogCommand, { kind: 'dose.add' }> {
  const cmd = writer.calls.at(-1)
  if (cmd?.kind !== 'dose.add') throw new Error(`Expected a dose.add, got ${cmd?.kind}`)
  return cmd
}

async function enterPin(w: VueWrapper, name: string, pin: string) {
  await click(w.get(`button[aria-label="${name}"]`))
  for (const digit of pin) await click(w.get(`button[aria-label="${digit}"]`))
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

describe('medicine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    setOnline(true)
    useHouseholdStore().stop()
    useLogStore().stop()
    vi.useRealTimers()
  })

  describe('MedicineSheet', () => {
    it("lists only the picked child's medicines with their schedules, with no child preselected", async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()

      expect(w.text()).toContain('Timing only — follow the label or your doctor for amounts.')
      expect(checked(w, 'Child')).toEqual([])
      expect(w.find('[aria-label="Medicine"]').exists()).toBe(false)

      await click(radio(w, 'Child', 'Theo'))
      const theoMeds = w.get('[aria-label="Medicine"]').findAll('[role="radio"]').map((r) => r.text())
      expect(theoMeds).toEqual(['Infant ibuprofenEvery 6h · max 4/day', 'Infant acetaminophenEvery 4h · max 5/day'])

      await click(radio(w, 'Medicine', 'Infant ibuprofen'))
      await click(radio(w, 'Child', 'Ivy'))
      expect(w.get('[aria-label="Medicine"]').findAll('[role="radio"]').map((r) => r.text())).toEqual([
        "Children's ibuprofenEvery 6h · max 4/day",
      ])
      expect(checked(w, 'Medicine')).toEqual([])
      expect(w.get('[aria-label="Child"]').text()).toContain('Ivy')
    })

    it('warns 1 h after the seeded ibuprofen dose, requires Who, and records the confirmed warnings', async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()

      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant ibuprofen'))
      for (let i = 0; i < 12; i++) await click(button(w, '−5 min')) // 2:00 PM, 1 h after Sam's 1:00 PM dose

      expect(w.get('[data-testid="dose-warnings"]').text()).toBe('Last dose was 1h 0m ago by Sam. Minimum is 6h.')
      expect(w.get('[aria-label="Who"]').attributes('aria-required')).toBe('true')
      expect(button(w, 'Confirm and save').attributes('disabled')).toBeDefined() // Who not chosen yet
      expect(w.findAll('button').some((b) => b.text() === 'Save')).toBe(false)

      await click(radio(w, 'Who', 'Alex'))
      await click(radio(w, 'Who', 'Alex')) // required: tapping again keeps the choice
      expect(checked(w, 'Who').join()).toContain('Alex')
      await w.get('input').setValue(' 2.5 ml ')
      await click(button(w, 'Confirm and save'))

      const cmd = lastDose()
      expect(cmd.entry).toMatchObject({
        childId: THEO,
        medicineId: IBUPROFEN_THEO,
        at: '2026-09-14T18:00:00.000Z',
        loggedByName: 'Alex',
        loggedOffline: false,
        voidedAt: null,
        conflictAcknowledgedAt: null,
        note: '2.5 ml',
        warningsConfirmed: ['early'],
      })
      expect(cmd.attribution).toEqual({ displayId: 'display-1', loggedByMembershipId: ALEX, sitterSessionId: null, loggedByName: 'Alex' })
      expect(w.emitted('saved')).toEqual([['saved']])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('keeps "Time given" on the clock while the sheet stays open, recomputing the warning, until the adult steps it', async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant ibuprofen'))
      await click(radio(w, 'Who', 'Sam'))
      expect(w.get('[data-testid="dose-warnings"]').text()).toBe('Last dose was 2h 0m ago by Sam. Minimum is 6h.')

      vi.advanceTimersByTime(25 * 60_000) // the adult was distracted
      await flushPromises()
      expect(w.get('[data-testid="dose-warnings"]').text()).toBe('Last dose was 2h 25m ago by Sam. Minimum is 6h.')
      expect(button(w, '+5 min').attributes('disabled')).toBeDefined() // already at the live "now"
      await click(button(w, 'Confirm and save'))

      expect(lastDose().entry.at).toBe('2026-09-14T19:25:00.000Z')
    })

    it('a stepped "Time given" stays put as the clock moves on', async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant acetaminophen'))
      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, '−5 min'))

      vi.advanceTimersByTime(25 * 60_000)
      await flushPromises()
      expect(button(w, '+5 min').attributes('disabled')).toBeUndefined()
      await click(button(w, 'Save'))

      expect(lastDose().entry.at).toBe('2026-09-14T18:55:00.000Z')
    })

    it('does not save when the warnings changed since they were shown; the next tap confirms the new ones', async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant ibuprofen'))
      await click(radio(w, 'Who', 'Sam'))
      expect(button(w, 'Confirm and save').exists()).toBe(true) // early warning shown

      // Another display's doses arrive: this one would now also be over the daily maximum. The label doesn't change.
      const template = serverSnapshot.doses[0]!
      for (const hour of ['05', '08', '11']) {
        serverSnapshot.doses.push({ ...template, id: `other-${hour}`, at: `2026-09-14T${hour}:00:00.000Z`, loggedByName: 'Alex' })
      }
      await useHouseholdStore().reload()
      await click(button(w, 'Confirm and save'))

      expect(writer.calls).toEqual([])
      expect(w.get('[data-testid="warnings-changed"]').text()).toBe('Warnings changed — review and confirm.')
      expect(w.get('[data-testid="dose-warnings"]').text()).toContain('This would be dose 5 in 24 hours. Maximum is 4.')
      expect(w.emitted('close')).toBeUndefined()

      await click(button(w, 'Confirm and save'))
      expect(lastDose().entry.warningsConfirmed).toEqual(['early', 'overMax'])
      expect(w.emitted('close')).toHaveLength(1)
    })

    it("the adult's own changes to what's being logged don't count as warnings changing under them", async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant acetaminophen'))
      await click(radio(w, 'Who', 'Sam'))
      await click(radio(w, 'Medicine', 'Infant ibuprofen')) // now warns early
      await click(button(w, 'Confirm and save'))

      expect(w.find('[data-testid="warnings-changed"]').exists()).toBe(false)
      expect(lastDose().entry.warningsConfirmed).toEqual(['early'])
    })

    it('says "Save" with no warnings and records none', async () => {
      await setup()
      const w = mountIt(MedicineSheet)
      await flushPromises()

      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant acetaminophen'))
      expect(w.find('[data-testid="dose-warnings"]').exists()).toBe(false)
      expect(button(w, 'Save').attributes('disabled')).toBeDefined()
      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, 'Save'))

      expect(lastDose().entry).toMatchObject({ medicineId: ACETAMINOPHEN_THEO, warningsConfirmed: [], note: null, loggedByName: 'Sam' })
      expect(lastDose().attribution.loggedByMembershipId).toBe(SAM)
    })

    it('in Sitter Mode, saves without a Who pick and attributes the dose to the sitter', async () => {
      await setup({ sitter: true })
      const w = mountIt(MedicineSheet)
      await flushPromises()

      await click(radio(w, 'Child', 'Ivy'))
      await click(radio(w, 'Medicine', "Children's ibuprofen"))
      expect(w.find('[aria-label="Who"]').exists()).toBe(false)
      expect(w.get('[data-testid="sitter-who"]').text()).toBe('Logged by Jess (sitter)')
      await click(button(w, 'Save'))

      expect(lastDose().entry).toMatchObject({ childId: IVY, loggedByName: 'Jess (sitter)' })
      expect(lastDose().attribution).toEqual({
        displayId: 'display-1', loggedByMembershipId: null, sitterSessionId: '99999999-0000-0000-0000-000000000001', loggedByName: 'Jess (sitter)',
      })
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('asks before logging when other adults\' doses can\'t be checked, and logs it as offline', async () => {
      await setup({ realtime: null }) // realtime never connected
      const w = mountIt(MedicineSheet)
      await flushPromises()

      await click(radio(w, 'Child', 'Theo'))
      await click(radio(w, 'Medicine', 'Infant acetaminophen'))
      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, 'Save'))

      expect(writer.calls).toEqual([])
      expect(w.get('[role="alert"]').text()).toBe("Can't check whether another adult gave a dose. Log anyway?")
      expect(w.emitted('close')).toBeUndefined()

      await click(button(w, 'Cancel')) // back to the form, choices kept
      expect(checked(w, 'Medicine').join()).toContain('Infant acetaminophen')
      await click(button(w, 'Save'))
      await click(button(w, 'Log anyway'))

      expect(lastDose().entry).toMatchObject({ medicineId: ACETAMINOPHEN_THEO, loggedOffline: true })
      expect(w.emitted('saved')).toHaveLength(1)
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('shows a save error inline and stays open', async () => {
      await setup()
      writer.failNextWith = new LogWriteError('check constraint', false, '23514')
      const w = mountIt(MedicineSheet)
      await flushPromises()

      await click(radio(w, 'Child', 'Ivy'))
      await click(radio(w, 'Medicine', "Children's ibuprofen"))
      await click(radio(w, 'Who', 'Sam'))
      await click(button(w, 'Save'))

      expect(w.get('[role="alert"]').text()).toBe("Couldn't save that. Please try again.")
      expect(w.emitted('close')).toBeUndefined()
      expect(lastDose().entry.childId).toBe(IVY)
    })
  })

  describe('DosePinDialog', () => {
    it('acknowledges a dose alert with the verified adult and PIN', async () => {
      await setup({ conflict: true })
      const w = mountIt(DosePinDialog, { action: 'acknowledge', doseId: CONFLICT_DOSE })
      await flushPromises()

      expect(w.get('[role="dialog"]').text()).toContain('Acknowledge dose alert')
      await enterPin(w, 'Alex', '1234')

      expect(writer.calls).toEqual([
        { kind: 'dose.acknowledge', householdId: HOUSEHOLD_ID, doseId: CONFLICT_DOSE, membershipId: ALEX, pin: '1234' },
      ])
      expect(w.emitted('done')).toHaveLength(1)
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('does not act on a wrong PIN', async () => {
      await setup({ conflict: true })
      const w = mountIt(DosePinDialog, { action: 'acknowledge', doseId: CONFLICT_DOSE })
      await flushPromises()

      await enterPin(w, 'Sam', '0000')

      expect(w.text()).toContain("That PIN didn't match.")
      expect(writer.calls).toEqual([])
      expect(w.emitted('close')).toBeUndefined()
    })

    it('shows a failed acknowledgement in the dialog and resets the pad', async () => {
      await setup({ conflict: true })
      writer.failNextWith = new LogWriteError('invalid pin', false, 'P0001')
      const w = mountIt(DosePinDialog, { action: 'acknowledge', doseId: CONFLICT_DOSE })
      await flushPromises()

      await enterPin(w, 'Sam', '1234')

      expect(w.get('[role="alert"]').text()).toBe("Couldn't acknowledge the alert. Try again.")
      expect(w.find('button[aria-label="Sam"]').exists()).toBe(true) // back to choosing an adult
      expect(w.emitted('close')).toBeUndefined()
    })

    it('asks for a connection when offline', async () => {
      await setup({ conflict: true })
      setOnline(false)
      const w = mountIt(DosePinDialog, { action: 'acknowledge', doseId: CONFLICT_DOSE })
      await flushPromises()

      expect(w.text()).toContain('Connect to acknowledge.')
      expect(w.find('[data-keypad]').exists()).toBe(false)
      expect(w.find('button[aria-label="Sam"]').exists()).toBe(false)
      await click(button(w, 'Close'))
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('offline, undoing a dose that never synced removes it without a PIN', async () => {
      await setup()
      const logStore = useLogStore()
      setOnline(false)
      const sheet = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(sheet, 'Child', 'Theo'))
      await click(radio(sheet, 'Medicine', 'Infant acetaminophen'))
      await click(radio(sheet, 'Who', 'Sam'))
      await click(button(sheet, 'Save'))
      await click(button(sheet, 'Log anyway'))
      sheet.unmount()
      wrapper = null
      const doseId = logStore.lastAction?.command.kind === 'dose.add' ? logStore.lastAction.command.entry.id : ''
      expect(useHouseholdStore().view?.doses.some((d) => d.id === doseId)).toBe(true)

      const w = mountIt(DosePinDialog, { action: 'undo', doseId })
      await flushPromises()

      expect(w.get('[role="status"]').text()).toBe("This dose hadn't synced yet — removed.")
      expect(w.find('[data-keypad]').exists()).toBe(false)
      expect(w.text()).not.toContain('Connect to undo')
      expect(writer.calls).toEqual([])
      expect(useHouseholdStore().view?.doses.some((d) => d.id === doseId)).toBe(false)
      expect(logStore.pendingCount).toBe(0)
      expect(w.emitted('done')).toHaveLength(1)
      await click(button(w, 'Close'))
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('online, undoing a dose still waiting in the queue removes it after the PIN instead of voiding it', async () => {
      await setup()
      const logStore = useLogStore()
      writer.ready = async () => false // no session yet: the queue can't send
      setOnline(false)
      const sheet = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(sheet, 'Child', 'Theo'))
      await click(radio(sheet, 'Medicine', 'Infant acetaminophen'))
      await click(radio(sheet, 'Who', 'Sam'))
      await click(button(sheet, 'Save'))
      await click(button(sheet, 'Log anyway'))
      sheet.unmount()
      wrapper = null
      const doseId = logStore.lastAction?.command.kind === 'dose.add' ? logStore.lastAction.command.entry.id : ''
      setOnline(true)
      await flushPromises()
      expect(logStore.pendingCount).toBe(1)

      const w = mountIt(DosePinDialog, { action: 'undo', doseId })
      await flushPromises()
      await enterPin(w, 'Sam', '1234')

      expect(writer.calls).toEqual([])
      expect(logStore.pendingCount).toBe(0)
      expect(useHouseholdStore().view?.doses.some((d) => d.id === doseId)).toBe(false)
      expect(w.emitted('done')).toHaveLength(1)
      expect(w.emitted('close')).toHaveLength(1)
    })

    it('undoes a just-logged dose by voiding it after the PIN, even once the undo window has passed', async () => {
      await setup()
      const logStore = useLogStore()
      const sheet = mountIt(MedicineSheet)
      await flushPromises()
      await click(radio(sheet, 'Child', 'Theo'))
      await click(radio(sheet, 'Medicine', 'Infant acetaminophen'))
      await click(radio(sheet, 'Who', 'Sam'))
      await click(button(sheet, 'Save'))
      const doseId = lastDose().entry.id
      sheet.unmount()
      wrapper = null

      expect(await logStore.undo()).toBe('needsPin')

      const w = mountIt(DosePinDialog, { action: 'undo', doseId })
      await flushPromises()
      expect(w.get('[role="dialog"]').text()).toContain('Undo dose')
      await vi.advanceTimersByTimeAsync(11_000) // the adult takes a while to find their PIN
      await enterPin(w, 'Sam', '1234')

      expect(writer.calls.at(-1)).toEqual({
        kind: 'dose.void',
        householdId: HOUSEHOLD_ID,
        doseId,
        membershipId: SAM,
        pin: '1234',
        reason: 'Undone within 10 seconds',
      })
      expect(logStore.lastAction).toBeNull()
      expect(w.emitted('done')).toHaveLength(1)
    })
  })
})
