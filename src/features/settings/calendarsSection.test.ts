import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { CalendarError, type CalendarPerson, type CalendarSettingsApi, type MyConnection } from '@/data/calendarApi'
import CalendarsSection from './sections/CalendarsSection.vue'

vi.mock('@/data/householdSource', () => ({ isDemo: false }))
vi.mock('@/data/supabase', () => {
  throw new Error('Display client loaded by a calendar settings test')
})

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const IVY = 'cccccccc-0000-0000-0000-000000000001'
const CLIENT = { name: 'adult-client' }

const PEOPLE: CalendarPerson[] = [
  { type: 'member', id: SAM, name: 'Sam', color: '#653437' },
  { type: 'child', id: IVY, name: 'Ivy', color: '#D9A441' },
]

const connection = (over: Partial<MyConnection> = {}): MyConnection => ({
  id: 'conn-1',
  provider: 'ics',
  label: 'Family',
  status: 'ok',
  canWrite: false,
  calendars: [{ id: 'sel-1', name: 'Family', visible: false, gone: false, assignee: null }],
  ...over,
})

type Fake = { [K in keyof CalendarSettingsApi]: ReturnType<typeof vi.fn> }

function fakeApi(): Fake {
  return {
    listMyConnections: vi.fn().mockResolvedValue([connection()]),
    listHouseholdConnections: vi.fn().mockResolvedValue([]),
    listPeople: vi.fn().mockResolvedValue(PEOPLE),
    connectIcs: vi.fn().mockResolvedValue({ connectionId: 'conn-2', selectionId: 'sel-2', name: 'Soccer', alreadyConnected: false }),
    startOAuth: vi.fn().mockResolvedValue({ notConfigured: true }),
    finishOAuth: vi.fn(),
    setSelection: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    createEvent: vi.fn(),
    connectIcsWithPin: vi.fn().mockResolvedValue({ connectionId: 'conn-2', selectionId: 'sel-2', name: 'Soccer', alreadyConnected: false }),
    setSelectionWithPin: vi.fn().mockResolvedValue(undefined),
    disconnectWithPin: vi.fn().mockResolvedValue(undefined),
    createEventWithPin: vi.fn(),
  }
}

let api: Fake

async function mountSection(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const w = mount(CalendarsSection, {
    props: { client: CLIENT as never, householdId: HOUSEHOLD, membershipId: SAM, surface: 'browser', api: api as never, ...props },
    attachTo: document.body,
  })
  await flushPromises()
  return w
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function buttonByText(w: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

beforeEach(() => {
  api = fakeApi()
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('CalendarsSection', () => {
  it('lists my connections with their calendars and people to assign', async () => {
    const w = await mountSection()
    expect(api.listMyConnections).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, SAM)
    const card = w.get('[data-testid="connection-conn-1"]')
    expect(card.text()).toContain('Family')
    expect(card.text()).toContain('Calendar link · Connected')
    expect(w.get('[data-testid="visible-sel-1"]').attributes('aria-checked')).toBe('false')
    const people = w.findAll('[data-testid^="assign-sel-1-"]')
    expect(people.map((p) => p.text())).toEqual(['S Sam', 'I Ivy'])
    expect(people[0]!.find('[aria-hidden="true"]').exists()).toBe(true)
  })

  it('says when a connection needs reconnecting', async () => {
    api.listMyConnections.mockResolvedValue([connection({ provider: 'google', label: 'sam@example.com', status: 'auth_expired' })])
    const w = await mountSection()
    expect(w.get('[data-testid="connection-conn-1"]').text()).toContain('Google · Needs reconnecting')
  })

  describe('connect a calendar link', () => {
    it('connects, clears the link, reloads the list and moves focus to the new connection', async () => {
      const w = await mountSection()
      api.listMyConnections.mockResolvedValue([connection(), connection({ id: 'conn-2', label: 'Soccer', calendars: [] })])
      await w.get('input[type="url"]').setValue(' webcal://example.com/family.ics ')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(api.connectIcs).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, 'webcal://example.com/family.ics')
      expect(w.get('[role="status"]').text()).toContain('Connected “Soccer”')
      expect((w.get('input[type="url"]').element as HTMLInputElement).value).toBe('')
      expect(api.listMyConnections).toHaveBeenCalledTimes(2)
      expect(document.activeElement).toBe(w.get('[data-testid="connection-conn-2"] [data-connection-heading]').element)
    })

    it('keeps focus on the Connect link button while connecting, then moves it to the notice if the connection isn’t listed', async () => {
      const pending = deferred<{ connectionId: string; selectionId: string; name: string; alreadyConnected: boolean }>()
      api.connectIcs.mockReturnValue(pending.promise)
      const w = await mountSection()
      await w.get('input[type="url"]').setValue('https://example.com/family.ics')
      const submit = buttonByText(w, 'Connect link')
      ;(submit.element as HTMLElement).focus()
      await w.get('form').trigger('submit')
      expect(submit.attributes('disabled')).toBeUndefined()
      expect(submit.attributes('aria-disabled')).toBe('true')
      expect(document.activeElement).toBe(submit.element)
      await w.get('form').trigger('submit')
      expect(api.connectIcs).toHaveBeenCalledTimes(1)
      pending.resolve({ connectionId: 'conn-1', selectionId: 'sel-1', name: 'Family', alreadyConnected: true })
      await flushPromises()
      expect(document.activeElement).toBe(w.get('[data-calendars-notice]').element)
    })

    it('says when the calendar was already connected', async () => {
      api.connectIcs.mockResolvedValue({ connectionId: 'conn-1', selectionId: 'sel-1', name: 'Family', alreadyConnected: true })
      const w = await mountSection()
      await w.get('input[type="url"]').setValue('https://example.com/family.ics')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(w.get('[role="status"]').text()).toBe('That calendar is already connected.')
    })

    it.each([
      ['invalid_url', 'That doesn’t look like a calendar link. Paste the whole link, starting with https:// or webcal://.'],
      ['not_a_calendar', 'That link isn’t a calendar. Copy the secret iCal address (it usually ends in .ics) and try again.'],
      ['too_large', 'That calendar is unusually large. Try a link with fewer calendars in it.'],
      ['unreachable', 'We couldn’t reach that calendar link. Check the link and try again.'],
      ['forbidden', 'Roost Family didn’t accept your sign-in. Sign in again.'],
      ['rate_limited', 'Too many calendar links added recently. Try again in an hour.'],
      ['not_configured', 'Calendar links aren’t set up on this server yet.'],
      ['internal', 'Something went wrong. Try again.'],
    ] as const)('words %s for the adult and keeps the link', async (code, message) => {
      api.connectIcs.mockRejectedValue(new CalendarError(code))
      const w = await mountSection()
      await w.get('input[type="url"]').setValue('https://example.com/x')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(w.get('[data-testid="ics-error"]').text()).toBe(message)
      expect((w.get('input[type="url"]').element as HTMLInputElement).value).toBe('https://example.com/x')
    })

    it('asks for a link before connecting', async () => {
      const w = await mountSection()
      await w.get('form').trigger('submit')
      expect(w.get('[data-testid="ics-error"]').text()).toBe('Paste your calendar’s link first.')
      expect(api.connectIcs).not.toHaveBeenCalled()
    })
  })

  describe('on a display, with the Settings PIN', () => {
    const PIN = { membershipId: SAM, pin: '1234' }
    const onPin = () => mountSection({ surface: 'display', pin: PIN })

    it('reads with the display\'s client and makes every change with the PIN', async () => {
      const w = await onPin()
      expect(api.listMyConnections).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, SAM)

      await w.get('input[type="url"]').setValue('https://example.com/family.ics')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(api.connectIcsWithPin).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, PIN, 'https://example.com/family.ics')
      expect(api.connectIcs).not.toHaveBeenCalled()

      await w.get(`[data-testid="assign-sel-1-${IVY}"]`).trigger('click')
      await flushPromises()
      expect(api.setSelectionWithPin).toHaveBeenCalledWith(CLIENT, PIN, 'sel-1', false, { type: 'child', id: IVY })
      expect(api.setSelection).not.toHaveBeenCalled()

      await buttonByText(w, 'Disconnect').trigger('click')
      await buttonByText(w, 'Disconnect Family').trigger('click')
      await flushPromises()
      expect(api.disconnectWithPin).toHaveBeenCalledWith(CLIENT, PIN, 'conn-1')
      expect(api.disconnect).not.toHaveBeenCalled()
      w.unmount()
    })

    it('points a refused call at the PIN, not at an email sign-in', async () => {
      api.connectIcsWithPin.mockRejectedValue(new CalendarError('forbidden'))
      const w = await onPin()
      await w.get('input[type="url"]').setValue('https://example.com/x')
      await w.get('form').trigger('submit')
      await flushPromises()
      expect(w.get('[data-testid="ics-error"]').text()).toBe('Roost Family didn’t accept your PIN. Close Settings and open it again.')
      w.unmount()
    })
  })

  describe('Google', () => {
    it('disables Google when it isn’t set up yet', async () => {
      const w = await mountSection()
      await w.get('[data-testid="connect-google"]').trigger('click')
      await flushPromises()
      expect(api.startOAuth).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, 'google')
      const google = w.get('[data-testid="connect-google"]')
      expect(google.text()).toBe('Connect Google — Not set up yet')
      expect(google.attributes('aria-disabled')).toBe('true')
    })

    it('goes to the provider’s consent page', async () => {
      api.startOAuth.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' })
      const navigate = vi.fn()
      const w = await mountSection({ navigate })
      await w.get('[data-testid="connect-google"]').trigger('click')
      await flushPromises()
      expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
    })

    it('offers no Microsoft account anywhere, on either surface', async () => {
      for (const surface of ['browser', 'display'] as const) {
        const w = await mountSection({ surface })
        expect(w.find('[data-testid="connect-microsoft"]').exists()).toBe(false)
        // Nothing in the section invites an Outlook or Microsoft *account*. The one remaining mention is where to
        // find an Outlook calendar's ICS link, which Roost does support.
        expect(w.text()).not.toContain('Connect Microsoft')
        expect(w.text()).not.toContain('Microsoft')
        w.unmount()
      }
    })

    it('says when there were too many connection attempts, keeping focus on the button', async () => {
      api.startOAuth.mockRejectedValue(new CalendarError('rate_limited'))
      const w = await mountSection()
      const google = w.get('[data-testid="connect-google"]')
      ;(google.element as HTMLElement).focus()
      await google.trigger('click')
      await flushPromises()
      expect(w.get('[role="alert"]').text()).toBe('Too many connection attempts. Try again in a few minutes.')
      expect(document.activeElement).toBe(google.element)
    })

    it('keeps focus on a provider that turns out not to be set up', async () => {
      const w = await mountSection()
      const google = w.get('[data-testid="connect-google"]')
      ;(google.element as HTMLElement).focus()
      await google.trigger('click')
      await flushPromises()
      expect(google.attributes('aria-disabled')).toBe('true')
      expect(document.activeElement).toBe(google.element)
      await google.trigger('click')
      expect(api.startOAuth).toHaveBeenCalledTimes(1)
    })

    it('on a display, keeps it disabled and points to Manage household', async () => {
      const w = await mountSection({ surface: 'display' })
      expect(w.get('[data-testid="connect-google"]').attributes('disabled')).toBeDefined()
      expect(w.text()).toContain('Connect Google from Manage household on your phone or computer: roost.cmrd.dev/manage')
      await w.get('[data-testid="connect-google"]').trigger('click')
      expect(api.startOAuth).not.toHaveBeenCalled()
    })
  })

  describe('show and assign', () => {
    it('asks whose calendar it is before showing an unassigned calendar, then shows it for that person', async () => {
      const w = await mountSection()
      await w.get('[data-testid="visible-sel-1"]').trigger('click')
      await flushPromises()
      expect(api.setSelection).not.toHaveBeenCalled()
      expect(w.get('[data-testid="choose-person"]').text()).toBe('Choose whose calendar this is to show it.')

      await w.get(`[data-testid="assign-sel-1-${IVY}"]`).trigger('click')
      await flushPromises()
      expect(api.setSelection).toHaveBeenCalledWith(CLIENT, 'sel-1', true, { type: 'child', id: IVY })
      expect(w.get('[data-testid="visible-sel-1"]').attributes('aria-checked')).toBe('true')
      expect(w.get(`[data-testid="assign-sel-1-${IVY}"]`).attributes('aria-checked')).toBe('true')
      expect(w.find('[data-testid="choose-person"]').exists()).toBe(false)
    })

    it('assigns a hidden calendar without showing it, and shows an assigned calendar at once', async () => {
      const w = await mountSection()
      await w.get(`[data-testid="assign-sel-1-${SAM}"]`).trigger('click')
      await flushPromises()
      expect(api.setSelection).toHaveBeenLastCalledWith(CLIENT, 'sel-1', false, { type: 'member', id: SAM })
      expect(w.get('[data-testid="visible-sel-1"]').attributes('aria-checked')).toBe('false')

      await w.get('[data-testid="visible-sel-1"]').trigger('click')
      await flushPromises()
      expect(api.setSelection).toHaveBeenLastCalledWith(CLIENT, 'sel-1', true, { type: 'member', id: SAM })

      await w.get('[data-testid="visible-sel-1"]').trigger('click')
      await flushPromises()
      expect(api.setSelection).toHaveBeenLastCalledWith(CLIENT, 'sel-1', false, { type: 'member', id: SAM })
    })

    it('keeps focus on the switch while saving and ignores taps until it’s done', async () => {
      api.listMyConnections.mockResolvedValue([connection({ calendars: [{ id: 'sel-1', name: 'Family', visible: false, gone: false, assignee: { type: 'child', id: IVY } }] })])
      const pending = deferred()
      api.setSelection.mockReturnValue(pending.promise)
      const w = await mountSection()
      const toggle = w.get('[data-testid="visible-sel-1"]')
      ;(toggle.element as HTMLElement).focus()
      await toggle.trigger('click')
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(toggle.attributes('aria-disabled')).toBe('true')
      expect(document.activeElement).toBe(toggle.element)
      await toggle.trigger('click')
      await w.get(`[data-testid="assign-sel-1-${SAM}"]`).trigger('click')
      expect(api.setSelection).toHaveBeenCalledTimes(1)
      pending.resolve()
      await flushPromises()
      expect(toggle.attributes('aria-checked')).toBe('true')
      expect(document.activeElement).toBe(toggle.element)
    })

    it('keeps focus on the chosen person after assigning, and arrow keys wait while saving', async () => {
      const pending = deferred()
      api.setSelection.mockReturnValue(pending.promise)
      const w = await mountSection()
      const sam = w.get(`[data-testid="assign-sel-1-${SAM}"]`)
      ;(sam.element as HTMLElement).focus()
      await sam.trigger('click')
      expect(document.activeElement).toBe(sam.element)
      await sam.trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(sam.element)
      expect(api.setSelection).toHaveBeenCalledTimes(1)
      pending.resolve()
      await flushPromises()
      expect(sam.attributes('aria-checked')).toBe('true')
      expect(sam.attributes('tabindex')).toBe('0')
      expect(document.activeElement).toBe(sam.element)

      api.setSelection.mockResolvedValue(undefined)
      await sam.trigger('keydown', { key: 'ArrowRight' })
      await flushPromises()
      const ivy = w.get(`[data-testid="assign-sel-1-${IVY}"]`)
      expect(document.activeElement).toBe(ivy.element)
      expect(ivy.attributes('aria-checked')).toBe('true')
    })

    it('reports busy to the host while a change is saving', async () => {
      const pending = deferred()
      api.setSelection.mockReturnValue(pending.promise)
      const w = await mountSection()
      await w.get(`[data-testid="assign-sel-1-${SAM}"]`).trigger('click')
      expect(w.emitted('busy')).toEqual([[true]])
      pending.resolve()
      await flushPromises()
      expect(w.emitted('busy')).toEqual([[true], [false]])
    })

    it('shows a refused change and keeps the calendar as it was', async () => {
      api.listMyConnections.mockResolvedValue([connection({ calendars: [{ id: 'sel-1', name: 'Family', visible: false, gone: false, assignee: { type: 'child', id: IVY } }] })])
      api.setSelection.mockRejectedValue(new CalendarError('network'))
      const w = await mountSection()
      await w.get('[data-testid="visible-sel-1"]').trigger('click')
      await flushPromises()
      expect(w.get('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
      expect(w.get('[data-testid="visible-sel-1"]').attributes('aria-checked')).toBe('false')
    })
  })

  it('shows only the latest list when reloads overlap, and clears a load error once a load works', async () => {
    const first = deferred<MyConnection[]>()
    api.listMyConnections.mockReturnValueOnce(first.promise)
    const w = await mountSection()
    api.listMyConnections.mockRejectedValueOnce(new CalendarError('network'))
    await w.setProps({ reloadKey: 1 })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Couldn’t load your calendars.')

    api.listMyConnections.mockResolvedValueOnce([connection({ label: 'Newest' })])
    await w.setProps({ reloadKey: 2 })
    await flushPromises()
    first.resolve([connection({ label: 'Stale' })])
    await flushPromises()
    expect(w.get('[data-testid="connection-conn-1"]').text()).toContain('Newest')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('disconnects after confirming', async () => {
    const w = await mountSection()
    await buttonByText(w, 'Disconnect').trigger('click')
    expect(api.disconnect).not.toHaveBeenCalled()
    expect(w.text()).toContain('Disconnect Family? Its events stop showing on your displays.')
    api.listMyConnections.mockResolvedValue([])
    await buttonByText(w, 'Disconnect Family').trigger('click')
    await flushPromises()
    expect(api.disconnect).toHaveBeenCalledWith(CLIENT, 'conn-1')
    expect(w.find('[data-testid="connection-conn-1"]').exists()).toBe(false)
    expect(w.text()).toContain('You haven’t connected a calendar yet.')
    expect(document.activeElement).toBe(w.get('[data-calendars-notice]').element)
    expect(document.activeElement?.textContent).toContain('Disconnected Family.')
  })

  it('reads the list again when reloadKey changes', async () => {
    const w = await mountSection()
    await w.setProps({ reloadKey: 1 })
    await flushPromises()
    expect(api.listMyConnections).toHaveBeenCalledTimes(2)
  })
})

describe('CalendarsSection — Add an event (Manage household)', () => {
  const writable = () =>
    connection({
      id: 'conn-w',
      provider: 'google',
      label: 'sam@example.com',
      canWrite: true,
      calendars: [{ id: 'sel-sam', name: 'Sam', visible: true, gone: false, assignee: { type: 'member', id: SAM } }],
    })

  const field = (w: VueWrapper, label: string) => {
    const lab = w.findAll('label').find((l) => l.text() === label)
    if (!lab) throw new Error(`No field "${label}"`)
    return w.get(`#${CSS.escape(lab.attributes('for')!)}`)
  }

  it('explains why an event cannot be added when nothing is writable', async () => {
    const w = await mountSection({ timeZone: 'America/New_York' })
    expect(w.get('[data-testid="manage-add-event-block"]').text()).toContain('one-way')
    expect(w.find('[data-testid="manage-event-save"]').exists()).toBe(false)
  })

  it('writes an event on the adult’s own sign-in, with no PIN', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T18:07:00Z'))
    api.listMyConnections.mockResolvedValue([writable()])
    api.createEvent.mockResolvedValue({
      selectionId: 'sel-sam',
      title: 'Dentist',
      startAt: '2026-09-14T20:00:00.000Z',
      endAt: '2026-09-14T20:30:00.000Z',
      allDay: false,
      location: null,
    })
    const w = await mountSection({ timeZone: 'America/New_York' })
    await w.get(`[data-testid="manage-event-person-${SAM}"]`).trigger('click')
    await field(w, 'What is it?').setValue('Dentist')
    await w.get('[data-testid="manage-event-start"]').setValue('16:00')
    expect(w.get('[data-testid="manage-event-target"]').text()).toBe('Adding to Sam · sam@example.com')
    await w.get('[data-testid="manage-event-save"]').trigger('click')
    await flushPromises()

    expect(api.createEvent).toHaveBeenCalledWith(CLIENT, HOUSEHOLD, {
      selectionId: 'sel-sam',
      title: 'Dentist',
      start: '2026-09-14T20:00:00.000Z',
      end: '2026-09-14T20:30:00.000Z',
      allDay: false,
      location: null,
    })
    expect(api.createEventWithPin).not.toHaveBeenCalled()
    expect(w.get('[data-testid="manage-add-event-notice"]').text()).toContain('Dentist')
    vi.useRealTimers()
  })

  it('reports a refusal and keeps what was typed', async () => {
    api.listMyConnections.mockResolvedValue([writable()])
    api.createEvent.mockRejectedValue(new CalendarError('auth_expired'))
    const w = await mountSection({ timeZone: 'UTC' })
    await w.get(`[data-testid="manage-event-person-${SAM}"]`).trigger('click')
    await field(w, 'What is it?').setValue('Dentist')
    await w.get('[data-testid="manage-event-save"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="manage-add-event-error"]').text()).toContain('needs reconnecting')
    expect((field(w, 'What is it?').element as HTMLInputElement).value).toBe('Dentist')
  })

  it('asks which calendar to use for a person who has none, and writes to it', async () => {
    api.listMyConnections.mockResolvedValue([writable()])
    api.createEvent.mockResolvedValue({
      selectionId: 'sel-sam',
      title: 'Swim',
      startAt: '2026-09-14T20:00:00.000Z',
      endAt: '2026-09-14T20:30:00.000Z',
      allDay: true,
      location: null,
    })
    const w = await mountSection({ timeZone: 'UTC' })
    await w.get(`[data-testid="manage-event-person-${IVY}"]`).trigger('click')
    expect(w.get('[data-testid="manage-event-calendar-note"]').text()).toContain('can’t be added to')
    await field(w, 'What is it?').setValue('Swim')
    expect(w.get('[data-testid="manage-event-problem"]').text()).toBe('Choose which calendar to add it to.')
    await w.get('[data-testid="manage-event-calendar"]').setValue('sel-sam')
    await w.get('[data-testid="manage-event-save"]').trigger('click')
    await flushPromises()
    expect((api.createEvent.mock.calls[0] as unknown[])[2]).toMatchObject({ selectionId: 'sel-sam' })
  })

  it('never offers Add event on a display, where the Today panel has it', async () => {
    api.listMyConnections.mockResolvedValue([writable()])
    const w = await mountSection({ surface: 'display', pin: { membershipId: SAM, pin: '1234' }, timeZone: 'UTC' })
    expect(w.find('[data-testid="manage-event-save"]').exists()).toBe(false)
    expect(w.find('[data-testid="manage-add-event-block"]').exists()).toBe(false)
  })
})
