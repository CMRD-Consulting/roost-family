import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { CalendarError, type CalendarSettingsApi, type HouseholdConnection } from '@/data/calendarApi'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSource } from '@/data/householdSource'
import type { RoostClient } from '@/data/supabase'
import { createFakeQueue, createFakeWriter, type FakeWriter } from '@/features/logs/sheetTestHelpers'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import AddEventSheet from './AddEventSheet.vue'

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const THEO = 'cccccccc-0000-0000-0000-000000000002'
const NOW = '2026-09-14T18:07:00Z' // 2:07 PM in New York
const CLIENT = { name: 'display-client' } as unknown as RoostClient

let pinia: Pinia
let writer: FakeWriter
let wrapper: VueWrapper | null = null

const connection = (over: Partial<HouseholdConnection> = {}): HouseholdConnection => ({
  id: 'conn-1',
  membershipId: SAM,
  provider: 'google',
  label: 'sam@example.com',
  status: 'ok',
  canWrite: true,
  calendars: [
    { id: 'sel-sam', name: 'Sam', visible: true, gone: false, assignee: { type: 'member', id: SAM } },
    { id: 'sel-ivy', name: 'Ivy school', visible: true, gone: false, assignee: { type: 'child', id: IVY } },
  ],
  ...over,
})

function fakeApi(connections: HouseholdConnection[]): CalendarSettingsApi {
  return {
    listMyConnections: vi.fn().mockResolvedValue([]),
    listHouseholdConnections: vi.fn().mockResolvedValue(connections),
    listPeople: vi.fn().mockResolvedValue([]),
    connectIcs: vi.fn(),
    startOAuth: vi.fn(),
    finishOAuth: vi.fn(),
    setSelection: vi.fn(),
    disconnect: vi.fn(),
    createEvent: vi.fn(),
    connectIcsWithPin: vi.fn(),
    setSelectionWithPin: vi.fn(),
    disconnectWithPin: vi.fn(),
    createEventWithPin: vi.fn().mockImplementation(async (_client, _householdId, _auth, event) => ({
      selectionId: event.selectionId,
      title: event.title,
      startAt: event.allDay ? '2026-09-15T04:00:00.000Z' : event.start,
      endAt: event.allDay ? '2026-09-16T04:00:00.000Z' : event.end,
      allDay: event.allDay,
      location: event.location ?? null,
    })),
  } as unknown as CalendarSettingsApi
}

async function setup(): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  pinia = createPinia()
  setActivePinia(pinia)
  const snapshot = buildDemoSnapshot(new Date(NOW))
  const source: HouseholdSource = { load: async () => structuredClone(snapshot), subscribe: () => () => {} }
  await useHouseholdStore().start(HOUSEHOLD_ID, source)
  writer = createFakeWriter()
  await useLogStore().init(writer, createFakeQueue())
}

async function mountSheet(connections: HouseholdConnection[], api = fakeApi(connections)) {
  wrapper = mount(AddEventSheet, { props: { open: true, api, client: CLIENT }, global: { plugins: [pinia] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, api }
}

/** RInput puts the test id on its wrapper, so fields are found by their label, as /manage's tests do. */
const field = (w: VueWrapper, label: string) => {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No field "${label}"`)
  return w.get(`#${CSS.escape(lab.attributes('for')!)}`)
}

const button = (w: VueWrapper, label: string) => {
  const found = w.findAll('button').find((b) => b.text() === label || b.attributes('aria-label') === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}

async function click(el: { trigger: (e: string) => Promise<void> }) {
  await el.trigger('click')
  await flushPromises()
}

/** Chooses the adult on the PIN pad and types their PIN (the fake writer accepts any). */
async function enterPin(w: VueWrapper, name = 'Sam'): Promise<void> {
  await click(button(w, name))
  for (const digit of ['1', '2', '3', '4']) await click(button(w, digit))
}

beforeEach(setup)

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('AddEventSheet — what can be written to', () => {
  it('explains that links are one-way instead of asking for a PIN, when nothing is writable', async () => {
    const { w } = await mountSheet([connection({ provider: 'ics', canWrite: false })])
    expect(w.get('[data-testid="add-event-block"]').text()).toContain('one-way')
    expect(w.find('[data-keypad]').exists()).toBe(false)
  })

  it('asks for a reconnection when the only writable account has stopped working', async () => {
    const { w } = await mountSheet([connection({ status: 'auth_expired' })])
    expect(w.get('[data-testid="add-event-block"]').text()).toContain('reconnecting')
  })

  it('asks for a calendar to be shown when none of a writable account’s is', async () => {
    const { w } = await mountSheet([connection({ calendars: [] })])
    expect(w.get('[data-testid="add-event-block"]').text()).toContain('shown on the displays')
  })

  it('says it needs a connection while the household is offline, and asks for nothing', async () => {
    useHouseholdStore().online = false
    const { w, api } = await mountSheet([connection()])
    expect(w.get('[data-testid="add-event-block"]').text()).toContain('needs a connection')
    expect(api.listHouseholdConnections).not.toHaveBeenCalled()
  })

  it('offers the PIN pad when there is a calendar to write to', async () => {
    const { w, api } = await mountSheet([connection()])
    expect(api.listHouseholdConnections).toHaveBeenCalledWith(CLIENT, HOUSEHOLD_ID)
    expect(w.find('[data-testid="add-event-block"]').exists()).toBe(false)
    expect(w.text()).toContain('Enter your PIN to add an event')
  })

  it('tells an adult with no writable calendar of their own, after their PIN', async () => {
    // The only writable connection is Sam's; Alex has none.
    const { w } = await mountSheet([connection()])
    await enterPin(w, 'Alex')
    expect(w.get('[data-testid="add-event-mine-block"]').text()).toContain('one-way')
    expect(w.findAll('label').some((l) => l.text() === 'What is it?')).toBe(false)
  })
})

describe('AddEventSheet — the form', () => {
  async function openForm(connections = [connection()]) {
    const { w, api } = await mountSheet(connections)
    await enterPin(w)
    return { w, api }
  }

  it('shows the form after the PIN, with the day and start time ready', async () => {
    const { w } = await openForm()
    expect(w.get('[data-testid="event-start"]').attributes('value') ?? (w.get('[data-testid="event-start"]').element as HTMLInputElement).value).toBe('14:15')
    expect(w.text()).toContain('Today')
    expect(w.text()).toContain('Tomorrow')
  })

  it('defaults to the chosen person’s own calendar and says which it is', async () => {
    const { w } = await openForm()
    await click(w.get(`[data-testid="event-person-${IVY}"]`))
    expect(w.get('[data-testid="event-calendar"]').text()).toBe('Adding to Ivy school · sam@example.com')
    expect(w.find('[data-testid="event-calendar-note"]').exists()).toBe(false)
  })

  it('says so and offers a choice when that person’s calendar can’t be written to', async () => {
    const { w } = await openForm()
    await click(w.get(`[data-testid="event-person-${THEO}"]`))
    expect(w.get('[data-testid="event-calendar-note"]').text()).toContain('can’t be added to')
    const choices = w.get('[role="radiogroup"][aria-label="Add to which calendar?"]').findAll('[role="radio"]')
    expect(choices.map((c) => c.text())).toEqual(['SamSam', 'sam@example.comIvy school'].map((_, i) => choices[i]!.text()))
    expect(choices).toHaveLength(2)
  })

  it('writes the event the adult described, in the household zone, and reports it back', async () => {
    const { w, api } = await openForm()
    await click(w.get(`[data-testid="event-person-${IVY}"]`))
    await field(w, 'What is it?').setValue('Swim lesson')
    await field(w, 'Where (optional)').setValue('  YMCA  Pool ')
    await w.get('[data-testid="event-start"]').setValue('16:00')
    await click(button(w, '45 min'))
    expect(w.get('[data-testid="event-summary"]').text()).toBe('Today · 4:00 PM – 4:45 PM')
    await click(w.get('[data-testid="event-save"]'))

    expect(api.createEventWithPin).toHaveBeenCalledWith(
      CLIENT,
      HOUSEHOLD_ID,
      { membershipId: SAM, pin: '1234' },
      {
        selectionId: 'sel-ivy',
        title: 'Swim lesson',
        start: '2026-09-14T20:00:00.000Z',
        end: '2026-09-14T20:45:00.000Z',
        allDay: false,
        location: 'YMCA Pool',
      },
    )
    // The panel is handed the row to show at once, in Ivy's own color, and the sheet closes.
    const added = w.emitted('added') as Array<[Record<string, unknown>]>
    expect(added).toHaveLength(1)
    expect(added[0]![0]).toMatchObject({ title: 'Swim lesson', personType: 'child', personId: IVY, allDay: false })
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('writes an all-day event as dates, with no start time asked for', async () => {
    const { w, api } = await openForm()
    await click(w.get(`[data-testid="event-person-${SAM}"]`))
    await field(w, 'What is it?').setValue('Library books due')
    await click(w.get('[data-testid="event-all-day"]'))
    expect(w.find('[data-testid="event-start"]').exists()).toBe(false)
    await click(button(w, 'Tomorrow'))
    expect(w.get('[data-testid="event-summary"]').text()).toBe('Tomorrow · All day')
    await click(w.get('[data-testid="event-save"]'))
    expect(api.createEventWithPin).toHaveBeenCalledWith(CLIENT, HOUSEHOLD_ID, expect.anything(), {
      selectionId: 'sel-sam',
      title: 'Library books due',
      start: '2026-09-15',
      end: '2026-09-16',
      allDay: true,
      location: null,
    })
  })

  it('writes to the calendar the adult picked instead of the person’s own', async () => {
    const { w, api } = await openForm()
    await click(w.get(`[data-testid="event-person-${THEO}"]`))
    await field(w, 'What is it?').setValue('Dentist')
    const choices = w.get('[role="radiogroup"][aria-label="Add to which calendar?"]').findAll('[role="radio"]')
    await click(choices[0]!)
    await click(w.get('[data-testid="event-save"]'))
    expect((api.createEventWithPin as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![3]).toMatchObject({ selectionId: 'sel-sam' })
  })

  it('keeps Add event unavailable until the form is complete, and says what is missing', async () => {
    const { w } = await openForm()
    expect(w.get('[data-testid="event-save"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="event-problem"]').text()).toBe('Give the event a name.')
    await field(w, 'What is it?').setValue('Swim')
    expect(w.get('[data-testid="event-problem"]').text()).toBe('Choose who the event is for.')
    await click(w.get(`[data-testid="event-person-${SAM}"]`))
    expect(w.get('[data-testid="event-save"]').attributes('disabled')).toBeUndefined()
  })

  it('refuses markup in the name before asking the provider', async () => {
    const { w } = await openForm()
    await click(w.get(`[data-testid="event-person-${SAM}"]`))
    await field(w, 'What is it?').setValue('<b>Swim</b>')
    expect(w.get('[data-testid="event-problem"]').text()).toContain('can’t contain')
    expect(w.get('[data-testid="event-save"]').attributes('disabled')).toBeDefined()
  })
})

describe('AddEventSheet — failures', () => {
  async function openForm(createEventWithPin: unknown) {
    const api = fakeApi([connection()])
    ;(api as unknown as Record<string, unknown>).createEventWithPin = createEventWithPin
    const { w } = await mountSheet([connection()], api)
    await enterPin(w)
    await click(w.get(`[data-testid="event-person-${SAM}"]`))
    await field(w, 'What is it?').setValue('Swim')
    return w
  }

  it('says what to do about a read-only calendar and keeps the form', async () => {
    const w = await openForm(vi.fn().mockRejectedValue(new CalendarError('not_writable')))
    await click(w.get('[data-testid="event-save"]'))
    expect(w.get('[data-testid="add-event-error"]').text()).toContain('Connect the account again')
    expect(w.findAll('label').some((l) => l.text() === 'What is it?')).toBe(true)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('sends the adult back to the pad when the PIN is refused', async () => {
    const w = await openForm(vi.fn().mockRejectedValue(new CalendarError('forbidden')))
    await click(w.get('[data-testid="event-save"]'))
    expect(w.text()).toContain('Enter your PIN to add an event')
    expect(w.text()).toContain('didn’t accept your PIN')
  })

  it('offers trying again when the provider could not be reached', async () => {
    const w = await openForm(vi.fn().mockRejectedValue(new CalendarError('unreachable')))
    await click(w.get('[data-testid="event-save"]'))
    expect(w.get('[data-testid="add-event-error"]').text()).toContain('Try again in a moment')
  })
})
