import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import {
  CALENDAR_REFRESH_MS,
  CalendarError,
  calendarConnectMessage,
  createCalendarSettingsApi,
  demoTodayEvents,
  fetchTodayEventsWith,
  resetTodayEventsForTests,
  useTodayEvents,
  type TodayEvents,
} from './calendarApi'
import type { RoostClient } from './supabase'

vi.mock('./householdSource', () => ({ isDemo: false }))
vi.mock('./supabase', () => {
  throw new Error('Display client loaded by a calendar test')
})

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER = 'aaaaaaaa-0000-0000-0000-000000000002'
const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T19:00:00Z') // 3:00 PM in New York

function body(generatedAt: string, title = 'Swim lesson') {
  return {
    events: [
      {
        title,
        startAt: '2026-09-14T20:00:00Z',
        endAt: '2026-09-14T21:00:00Z',
        allDay: false,
        location: 'YMCA Pool',
        personType: 'child',
        personId: 'cccccccc-0000-0000-0000-000000000001',
        calendarColor: '#D9A441',
      },
    ],
    connections: [{ id: 'conn-1', ownerName: 'Sam', status: 'ok' }],
    partial: false,
    generatedAt,
  }
}

/** A fake Response like the one FunctionsHttpError carries as `context`. */
const httpError = (status: number, payload: unknown) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: { status, json: async () => payload },
  })

function fakeClient(invoke: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}): RoostClient {
  return { functions: { invoke }, ...extra } as never
}

describe('fetchTodayEventsWith', () => {
  it('posts the household to calendar-events with a timeout, keeping generatedAt and the device receive time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const invoke = vi.fn().mockResolvedValue({ data: body('2026-09-14T18:58:00Z'), error: null })
    const result = await fetchTodayEventsWith(fakeClient(invoke), HOUSEHOLD)
    vi.useRealTimers()
    expect(invoke).toHaveBeenCalledWith('calendar-events', { body: { householdId: HOUSEHOLD }, timeout: 20_000 })
    expect(result.updatedAt).toBe('2026-09-14T18:58:00Z')
    expect(result.receivedAt).toBe(NOW.toISOString())
    expect(result.events).toHaveLength(1)
    expect(result.connections).toEqual([{ id: 'conn-1', ownerName: 'Sam', status: 'ok' }])
  })

  it('throws the server’s error code', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden' }) })
    await expect(fetchTodayEventsWith(fakeClient(invoke), HOUSEHOLD)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('keeps only well-formed events and connections, with only the allowed fields', async () => {
    const good = body('2026-09-14T18:58:00Z').events[0]!
    const data = {
      ...body('2026-09-14T18:58:00Z'),
      events: [
        { ...good, description: 'secret', attendees: ['a@example.com'] },
        { ...good, title: 42 },
        { ...good, startAt: 'yesterday' },
        { ...good, endAt: null },
        { ...good, allDay: 'no' },
        { ...good, personType: 'pet' },
        { ...good, personId: 7 },
        { ...good, calendarColor: null },
        { ...good, location: 5 },
        { ...good, title: 'No location', location: null },
        null,
        'event',
      ],
      connections: [
        { id: 'conn-1', ownerName: 'Sam', status: 'ok', secret: 'x' },
        { id: 'conn-2', ownerName: 'Alex', status: 'broken' },
        { id: 3, ownerName: 'Theo', status: 'ok' },
      ],
    }
    const invoke = vi.fn().mockResolvedValue({ data, error: null })
    const result = await fetchTodayEventsWith(fakeClient(invoke), HOUSEHOLD)
    expect(result.events.map((e) => e.title)).toEqual(['Swim lesson', 'No location'])
    expect(Object.keys(result.events[0]!).sort()).toEqual(
      ['allDay', 'calendarColor', 'endAt', 'location', 'personId', 'personType', 'startAt', 'title'],
    )
    expect(result.connections).toEqual([{ id: 'conn-1', ownerName: 'Sam', status: 'ok' }])
  })

  it('reports a request that timed out (aborted) as a network failure', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: Object.assign(new Error('The operation was aborted'), { name: 'FunctionsFetchError' }),
    })
    await expect(fetchTodayEventsWith(fakeClient(invoke), HOUSEHOLD)).rejects.toMatchObject({ code: 'network' })
  })

  it('rejects a response without events', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { nope: true }, error: null })
    await expect(fetchTodayEventsWith(fakeClient(invoke), HOUSEHOLD)).rejects.toBeInstanceOf(CalendarError)
  })
})

describe('demoTodayEvents', () => {
  it('has an all-day event and a timed event with a location that starts soon, all within today', () => {
    const result = demoTodayEvents(NOW, TZ)
    expect(result.events.some((e) => e.allDay)).toBe(true)
    const soon = result.events.find((e) => !e.allDay && e.location)
    expect(soon).toBeDefined()
    const inMinutes = (Date.parse(soon!.startAt) - NOW.getTime()) / 60_000
    expect(inMinutes).toBeGreaterThan(20)
    expect(inMinutes).toBeLessThan(120)
    expect(result.updatedAt).toBe(NOW.toISOString())
  })
})

describe('useTodayEvents', () => {
  let fetchEvents: ReturnType<typeof vi.fn<(householdId: string) => Promise<TodayEvents>>>
  let calls: number

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    resetTodayEventsForTests()
    calls = 0
    fetchEvents = vi.fn(async (_householdId: string): Promise<TodayEvents> => {
      calls += 1
      const r = body(new Date().toISOString(), `Event ${calls}`)
      return {
        events: r.events as TodayEvents['events'], connections: r.connections as TodayEvents['connections'], partial: false,
        updatedAt: r.generatedAt, receivedAt: r.generatedAt,
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  function setup(initial: { householdId?: string | null; online?: boolean; enabled?: boolean; timeZone?: string } = {}) {
    const householdId = ref<string | null>(initial.householdId === undefined ? HOUSEHOLD : initial.householdId)
    const online = ref(initial.online ?? true)
    const enabled = ref(initial.enabled ?? true)
    const timeZone = ref(initial.timeZone ?? TZ)
    const scope = effectScope()
    const today = scope.run(() =>
      useTodayEvents({
        householdId: () => householdId.value,
        timeZone: () => timeZone.value,
        online: () => online.value,
        enabled: () => enabled.value,
        fetchEvents,
      }),
    )!
    return { today, householdId, online, enabled, scope }
  }

  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('loads at once, then every 5 minutes', async () => {
    const { today, scope } = setup()
    await flushPromises()
    expect(fetchEvents).toHaveBeenCalledWith(HOUSEHOLD)
    expect(today.result.value?.events[0]?.title).toBe('Event 1')
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS - 1)
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    expect(today.result.value?.events[0]?.title).toBe('Event 2')
    scope.stop()
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS * 2)
    expect(fetchEvents).toHaveBeenCalledTimes(2)
  })

  it('refreshes when the page becomes visible again', async () => {
    const { scope } = setup()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(90_000)
    setVisibility('hidden')
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flushPromises()
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('keeps the last good result (and its updatedAt) when a refresh fails', async () => {
    const { today, scope } = setup()
    await flushPromises()
    const first = today.result.value
    fetchEvents.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS)
    expect(today.result.value).toBe(first)
    expect(today.result.value?.updatedAt).toBe(NOW.toISOString())
    expect(today.failed.value).toBe(true)
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS)
    expect(today.failed.value).toBe(false)
    expect(today.result.value?.events[0]?.title).toBe('Event 2')
    scope.stop()
  })

  it('does not ask while offline, and asks as soon as the connection is back', async () => {
    const { online, scope } = setup({ online: false })
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS)
    expect(fetchEvents).not.toHaveBeenCalled()
    online.value = true
    await nextTick()
    await flushPromises()
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('does not ask while disabled (Sitter Mode), and asks again when enabled', async () => {
    const { enabled, scope } = setup({ enabled: false })
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS)
    expect(fetchEvents).not.toHaveBeenCalled()
    enabled.value = true
    await nextTick()
    await flushPromises()
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('refreshes right after midnight in the household zone', async () => {
    // 11:58 PM in New York; the 5-minute interval alone would wait until 12:03 AM.
    vi.setSystemTime(new Date('2026-09-15T03:58:00Z'))
    const { scope } = setup()
    await flushPromises()
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1)
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_001) // just past midnight
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('stops its interval and visibility listener when its scope is disposed', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { scope } = setup()
    await flushPromises()
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')![1]
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    scope.stop()
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener)
    expect(vi.getTimerCount()).toBe(0)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(CALENDAR_REFRESH_MS * 2)
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    add.mockRestore()
    remove.mockRestore()
  })

  it('never shows a household’s answer after switching to another mid-request, and then asks for the new one', async () => {
    const pending: Array<{ id: string; resolve: (r: TodayEvents) => void }> = []
    fetchEvents.mockImplementation((id: string) => new Promise<TodayEvents>((resolve) => pending.push({ id, resolve })))
    const answer = (title: string): TodayEvents => ({
      events: [{ ...(body(NOW.toISOString()).events[0] as TodayEvents['events'][number]), title }],
      connections: [], partial: false, updatedAt: NOW.toISOString(), receivedAt: NOW.toISOString(),
    })
    const { today, householdId, scope } = setup()
    await flushPromises()
    expect(pending.map((p) => p.id)).toEqual([HOUSEHOLD])

    householdId.value = OTHER
    await nextTick()
    expect(pending).toHaveLength(1) // queued behind the running request, not in parallel

    pending[0]!.resolve(answer('Rivera event'))
    await flushPromises()
    expect(today.result.value).toBeNull()
    expect(pending.map((p) => p.id)).toEqual([HOUSEHOLD, OTHER])

    pending[1]!.resolve(answer('Lake event'))
    await flushPromises()
    expect(today.result.value?.events[0]?.title).toBe('Lake event')
    scope.stop()
  })

  it('discards an answer from before midnight that arrives after it, and asks again for the new day', async () => {
    vi.setSystemTime(new Date('2026-09-15T03:59:30Z')) // 11:59:30 PM in New York
    const pending: Array<(r: TodayEvents) => void> = []
    fetchEvents.mockImplementation(() => new Promise<TodayEvents>((resolve) => pending.push(resolve)))
    const answer = (title: string): TodayEvents => ({
      events: [{ ...(body(NOW.toISOString()).events[0] as TodayEvents['events'][number]), title }],
      connections: [], partial: false, updatedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
    })
    const { today, scope } = setup()
    await flushPromises()
    expect(pending).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(31_000) // midnight passes while the first request hangs
    expect(pending).toHaveLength(1)
    pending[0]!(answer('Yesterday'))
    await flushPromises()
    expect(today.result.value).toBeNull()
    expect(pending).toHaveLength(2)

    pending[1]!(answer('Today'))
    await flushPromises()
    expect(today.result.value?.events[0]?.title).toBe('Today')
    scope.stop()
  })

  it('asks again after a request fails (nothing stays in flight)', async () => {
    fetchEvents.mockRejectedValueOnce(new Error('timeout'))
    const { today, scope } = setup()
    await flushPromises()
    expect(today.failed.value).toBe(true)
    await today.refresh()
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    expect(today.failed.value).toBe(false)
    scope.stop()
  })

  it('keeps the last good result across remounts (memory only) and forgets it for another household', async () => {
    const first = setup()
    await flushPromises()
    first.scope.stop()

    fetchEvents.mockRejectedValue(new Error('offline'))
    const second = setup()
    expect(second.today.result.value?.events[0]?.title).toBe('Event 1')
    await flushPromises()
    second.householdId.value = OTHER
    await nextTick()
    expect(second.today.result.value).toBeNull()
    second.scope.stop()
  })
})

describe('createCalendarSettingsApi', () => {
  const api = createCalendarSettingsApi()

  it('lists my connections with explicit columns (never secrets or external ids)', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'conn-1', provider: 'ics', label: 'Family', status: 'ok', created_at: '2026-09-01T00:00:00Z',
          calendar_selections: [
            { id: 'sel-2', name: 'B', visible: false, gone: false, assigned_membership_id: null, assigned_child_id: null, created_at: '2026-09-02T00:00:00Z' },
            { id: 'sel-1', name: 'A', visible: true, gone: false, assigned_membership_id: null, assigned_child_id: 'child-1', created_at: '2026-09-01T00:00:00Z' },
          ],
        },
      ],
      error: null,
    })
    const eq2 = vi.fn(() => ({ order }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const select = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ select }))
    const client = { from } as never

    const rows = await api.listMyConnections(client, HOUSEHOLD, 'member-1')
    expect(from).toHaveBeenCalledWith('calendar_connections')
    const columns = (select.mock.calls[0] as unknown as [string])[0]
    expect(columns).not.toMatch(/vault_secret_id|external_calendar_id|\*/)
    expect(eq1).toHaveBeenCalledWith('household_id', HOUSEHOLD)
    expect(eq2).toHaveBeenCalledWith('membership_id', 'member-1')
    expect(rows).toEqual([
      {
        id: 'conn-1', provider: 'ics', label: 'Family', status: 'ok',
        calendars: [
          { id: 'sel-1', name: 'A', visible: true, gone: false, assignee: { type: 'child', id: 'child-1' } },
          { id: 'sel-2', name: 'B', visible: false, gone: false, assignee: null },
        ],
      },
    ])
  })

  it('connects a calendar link and maps function errors to codes', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { connectionId: 'c', selectionId: 's', name: 'Family' }, error: null })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'webcal://example.com/a.ics')).resolves.toEqual({
      connectionId: 'c', selectionId: 's', name: 'Family', alreadyConnected: false,
    })
    expect(invoke).toHaveBeenCalledWith('calendar-connect-ics', {
      body: { householdId: HOUSEHOLD, url: 'webcal://example.com/a.ics' }, timeout: 20_000,
    })

    invoke.mockResolvedValue({ data: { connectionId: 'c', selectionId: 's', name: 'Family', alreadyConnected: true }, error: null })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'https://x')).resolves.toMatchObject({ alreadyConnected: true })

    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'rate_limited' }) })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'https://x')).rejects.toMatchObject({ code: 'rate_limited' })
    invoke.mockResolvedValue({ data: null, error: httpError(503, { error: 'not_configured' }) })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'https://x')).rejects.toMatchObject({ code: 'not_configured' })

    invoke.mockResolvedValue({ data: null, error: httpError(422, { error: 'not_a_calendar' }) })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'https://x')).rejects.toMatchObject({ code: 'not_a_calendar' })

    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Failed to send'), { name: 'FunctionsFetchError' }) })
    await expect(api.connectIcs(fakeClient(invoke), HOUSEHOLD, 'https://x')).rejects.toMatchObject({ code: 'network' })
  })

  it('starts OAuth (always returning to Manage household), reporting not_configured as a result rather than an error', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { error: 'not_configured' }, error: null })
    await expect(api.startOAuth(fakeClient(invoke), HOUSEHOLD, 'google')).resolves.toEqual({ notConfigured: true })
    expect(invoke).toHaveBeenCalledWith('calendar-oauth-start', { body: { householdId: HOUSEHOLD, provider: 'google', returnTo: 'manage' }, timeout: 20_000 })
    invoke.mockResolvedValue({ data: { url: 'https://accounts.example/consent' }, error: null })
    await expect(api.startOAuth(fakeClient(invoke), HOUSEHOLD, 'microsoft')).resolves.toEqual({ url: 'https://accounts.example/consent' })
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'rate_limited' }) })
    await expect(api.startOAuth(fakeClient(invoke), HOUSEHOLD, 'google')).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('finishes an OAuth attempt, with expired and forbidden as codes', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { connectionId: 'c', calendars: 3, label: 'sam@example.com' }, error: null })
    await expect(api.finishOAuth(fakeClient(invoke), 'attempt-token')).resolves.toEqual({ connectionId: 'c', calendars: 3, label: 'sam@example.com' })
    expect(invoke).toHaveBeenCalledWith('calendar-oauth-finish', { body: { attempt: 'attempt-token' }, timeout: 20_000 })
    invoke.mockResolvedValue({ data: null, error: httpError(410, { error: 'expired' }) })
    await expect(api.finishOAuth(fakeClient(invoke), 'attempt-token')).rejects.toMatchObject({ code: 'expired' })
    invoke.mockResolvedValue({ data: null, error: httpError(404, { error: 'invalid_attempt' }) })
    await expect(api.finishOAuth(fakeClient(invoke), 'attempt-token')).rejects.toMatchObject({ code: 'invalid_attempt' })
  })

  it('sets a selection and disconnects through the RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as never
    await api.setSelection(client, 'sel-1', true, { type: 'member', id: 'member-2' })
    expect(rpc).toHaveBeenCalledWith('set_calendar_selection', {
      p_selection_id: 'sel-1', p_visible: true, p_assigned_membership_id: 'member-2', p_assigned_child_id: null,
    })
    await api.disconnect(client, 'conn-1')
    expect(rpc).toHaveBeenCalledWith('disconnect_calendar', { p_connection_id: 'conn-1' })

    rpc.mockResolvedValue({ data: null, error: { message: 'calendar not found', code: '42501' } })
    await expect(api.disconnect(client, 'conn-1')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('makes the same three changes with the Settings PIN, for a display', async () => {
    const PIN = { membershipId: 'member-1', pin: '1234' }
    const invoke = vi.fn().mockResolvedValue({ data: { connectionId: 'c', selectionId: 's', name: 'Family' }, error: null })
    await expect(api.connectIcsWithPin(fakeClient(invoke), HOUSEHOLD, PIN, 'https://example.com/a.ics')).resolves.toEqual({
      connectionId: 'c', selectionId: 's', name: 'Family', alreadyConnected: false,
    })
    expect(invoke).toHaveBeenCalledWith('calendar-connect-ics', {
      body: { householdId: HOUSEHOLD, url: 'https://example.com/a.ics', membershipId: 'member-1', pin: '1234' },
      timeout: 20_000,
    })

    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as never
    await api.setSelectionWithPin(client, PIN, 'sel-1', true, { type: 'child', id: 'child-2' })
    expect(rpc).toHaveBeenCalledWith('set_calendar_selection_pin', {
      p_membership_id: 'member-1', p_pin: '1234', p_selection_id: 'sel-1', p_visible: true,
      p_assigned_membership_id: null, p_assigned_child_id: 'child-2',
    })
    await api.disconnectWithPin(client, PIN, 'conn-1')
    expect(rpc).toHaveBeenCalledWith('disconnect_calendar_pin', {
      p_membership_id: 'member-1', p_pin: '1234', p_connection_id: 'conn-1',
    })

    rpc.mockResolvedValue({ data: null, error: { message: 'incorrect PIN', code: '42501' } })
    await expect(api.setSelectionWithPin(client, PIN, 'sel-1', false, null)).rejects.toMatchObject({ code: 'forbidden' })
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden' }) })
    await expect(api.connectIcsWithPin(fakeClient(invoke), HOUSEHOLD, PIN, 'https://x')).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('calendarConnectMessage', () => {
  it('words each failure for the adult', () => {
    expect(calendarConnectMessage(new CalendarError('invalid_url'))).toMatch(/https:\/\/ or webcal:\/\//)
    expect(calendarConnectMessage(new CalendarError('not_a_calendar'))).toMatch(/isn’t a calendar/)
    expect(calendarConnectMessage(new CalendarError('too_large'))).toMatch(/unusually large/)
    expect(calendarConnectMessage(new CalendarError('unreachable'))).toMatch(/We couldn’t reach that calendar link/)
    expect(calendarConnectMessage(new CalendarError('expired'))).toBe('That took too long. Connect again.')
    expect(calendarConnectMessage(new CalendarError('forbidden'))).toMatch(/sign-in/)
    expect(calendarConnectMessage(new CalendarError('network'))).toMatch(/Couldn’t reach Roost Family/)
    expect(calendarConnectMessage(new Error('boom'))).toMatch(/Try again/)
    expect(calendarConnectMessage(new CalendarError('rate_limited'))).toBe('Too many calendar links added recently. Try again in an hour.')
    expect(calendarConnectMessage(new CalendarError('rate_limited'), 'oauth')).toBe('Too many connection attempts. Try again in a few minutes.')
    expect(calendarConnectMessage(new CalendarError('not_configured'))).toBe('Calendar links aren’t set up on this server yet.')
  })
})
