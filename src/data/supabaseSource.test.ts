import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoostClient } from './supabase'
import { createSupabaseSource } from './supabaseSource'

type QueryResult = { data: unknown; error: { message: string } | null }
/** A single result, or a queue of results consumed in order across repeated calls to the same table. */
type QueryResultSpec = QueryResult | QueryResult[]

interface RecordedCall {
  table: string
  ops: string[]
}

interface RecordedRegistration {
  table: string
  filter?: string
  callback: () => void
}

interface FakeChannel {
  name: string
  registrations: RecordedRegistration[]
  statusCallback: ((status: string) => void) | undefined
  on: (type: string, config: { table: string; filter?: string }, cb: () => void) => FakeChannel
  subscribe: (cb?: (status: string) => void) => FakeChannel
}

function createFakeClient(tableData: Record<string, QueryResultSpec>) {
  const calls: RecordedCall[] = []
  const channels: FakeChannel[] = []
  const removeChannel = vi.fn()
  const callCounts: Record<string, number> = {}

  function from(table: string) {
    const call: RecordedCall = { table, ops: [] }
    calls.push(call)
    let mode: 'many' | 'single' | 'maybeSingle' = 'many'

    const builder = {
      select(columns: string) {
        call.ops.push(`select:${columns}`)
        return builder
      },
      eq(column: string, value: unknown) {
        call.ops.push(`eq:${column}=${String(value)}`)
        return builder
      },
      in(column: string, values: unknown[]) {
        call.ops.push(`in:${column}=${values.join(',')}`)
        return builder
      },
      is(column: string, value: unknown) {
        call.ops.push(`is:${column}=${String(value)}`)
        return builder
      },
      gte(column: string, value: unknown) {
        call.ops.push(`gte:${column}=${String(value)}`)
        return builder
      },
      lte(column: string, value: unknown) {
        call.ops.push(`lte:${column}=${String(value)}`)
        return builder
      },
      order(column: string, opts?: { ascending?: boolean }) {
        call.ops.push(`order:${column}:${opts?.ascending === false ? 'desc' : 'asc'}`)
        return builder
      },
      or(expr: string) {
        call.ops.push(`or:${expr}`)
        return builder
      },
      limit(n: number) {
        call.ops.push(`limit:${n}`)
        return builder
      },
      single() {
        mode = 'single'
        call.ops.push('single')
        return builder
      },
      maybeSingle() {
        mode = 'maybeSingle'
        call.ops.push('maybeSingle')
        return builder
      },
      then(
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        const spec = tableData[table] ?? { data: [], error: null }
        let result: QueryResult
        if (Array.isArray(spec)) {
          const index = callCounts[table] ?? 0
          callCounts[table] = index + 1
          result = spec[Math.min(index, spec.length - 1)] ?? { data: [], error: null }
        } else {
          result = spec
        }
        let data = result.data
        if ((mode === 'single' || mode === 'maybeSingle') && Array.isArray(data)) {
          data = data[0] ?? null
        }
        return Promise.resolve({ data, error: result.error }).then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  function channel(name: string): FakeChannel {
    const chan: FakeChannel = {
      name,
      registrations: [],
      statusCallback: undefined,
      on(type, config, cb) {
        chan.registrations.push({ table: config.table, filter: config.filter, callback: cb })
        return chan
      },
      subscribe(cb) {
        chan.statusCallback = cb
        return chan
      },
    }
    channels.push(chan)
    return chan
  }

  const client = { from, channel, removeChannel } as unknown as RoostClient
  return { client, calls, channels, removeChannel }
}

const householdRow = {
  id: 'h1',
  name: 'Rivera',
  time_zone: 'America/New_York',
  zip: null,
  lat: null,
  lon: null,
  plan: 'free',
  default_night_sleep_start: '18:00:00',
  default_night_sleep_end: '05:00:00',
  night_mode_start: '20:00:00',
  night_mode_end: '06:00:00',
  leave_by_buffer_min: 20,
  diaper_log_enabled: false,
  dinner_tonight: 'Tacos',
  sitter_info: {},
  created_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
}

const memberRow = {
  id: 'mem1',
  display_name: 'Sam',
  color: '#653437',
  role: 'owner',
}

function baseTableData(): Record<string, QueryResultSpec> {
  return {
    households: { data: [householdRow], error: null },
    memberships: { data: [memberRow], error: null },
    children: { data: [], error: null },
    feature_overrides: { data: [], error: null },
    medicines: { data: [], error: null },
    dose_entries: { data: [], error: null },
    sleep_entries: { data: [], error: null },
    feeding_entries: { data: [], error: null },
    diaper_entries: { data: [], error: null },
    sticker_categories: { data: [], error: null },
    sticker_entries: { data: [], error: null },
    routines: { data: [], error: null },
    routine_progress: { data: [], error: null },
    routine_day_overrides: { data: [], error: null },
    jots: { data: [], error: null },
    grocery_items: { data: [], error: null },
    sitter_sessions: { data: [], error: null },
  }
}

describe('createSupabaseSource load', () => {
  const now = new Date('2026-09-14T19:00:00Z')

  it('queries each table and maps rows into a HouseholdSnapshot', async () => {
    const { client, calls } = createFakeClient({
      ...baseTableData(),
      children: {
        data: [
          {
            id: 'c1', name: 'Ivy', birthday: '2023-04-10', color: '#C2477A', photo_id: null,
            allergies: '', food_rules: '', night_sleep_start: '19:00:00', night_sleep_end: '06:00:00',
            sort_order: 0, created_at: '2026-01-01T00:00:00Z',
          },
        ],
        error: null,
      },
      feature_overrides: { data: [{ id: 'o1', child_id: 'c1', feature: 'wakeWindow', enabled: true }], error: null },
    })
    const source = createSupabaseSource(client)
    const snapshot = await source.load('h1', now)

    expect(snapshot.household).toEqual({
      id: 'h1',
      name: 'Rivera',
      timeZone: 'America/New_York',
      defaultNightSleep: { start: '18:00', end: '05:00' },
      nightMode: { start: '20:00', end: '06:00' },
      leaveByBufferMin: 20,
      diaperLogEnabled: false,
      dinnerTonight: 'Tacos',
    })
    expect(snapshot.members).toEqual([{ id: 'mem1', displayName: 'Sam', color: '#653437', role: 'owner' }])
    expect(snapshot.children).toEqual([
      {
        id: 'c1', name: 'Ivy', birthday: '2023-04-10', color: '#C2477A',
        nightSleep: { start: '19:00', end: '06:00' }, sortOrder: 0, overrides: { wakeWindow: true },
      },
    ])
    expect(snapshot.activeSitterSession).toBeNull()
    expect(snapshot.loadedAt).toBe(now.toISOString())

    const householdsCall = calls.find((c) => c.table === 'households')
    expect(householdsCall?.ops).toContain('eq:id=h1')
    expect(householdsCall?.ops).toContain('single')

    const cutoff48h = new Date(now.getTime() - 48 * 3_600_000).toISOString()
    const cutoff8d = new Date(now.getTime() - 8 * 24 * 3_600_000).toISOString()
    const cutoff24h = new Date(now.getTime() - 24 * 3_600_000).toISOString()

    expect(calls.find((c) => c.table === 'memberships')?.ops).toEqual([
      'select:id, display_name, color, role', 'eq:household_id=h1', 'is:left_at=null',
    ])
    expect(calls.find((c) => c.table === 'children')?.ops).toEqual(['select:*', 'order:sort_order:asc'])
    expect(calls.find((c) => c.table === 'feature_overrides')?.ops).toEqual(['select:*'])
    expect(calls.find((c) => c.table === 'medicines')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'is:archived_at=null',
    ])
    expect(calls.find((c) => c.table === 'dose_entries')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `gte:at=${cutoff48h}`,
    ])
    expect(calls.find((c) => c.table === 'sleep_entries')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `or:start_at.gte.${cutoff48h},end_at.is.null`,
    ])
    expect(calls.find((c) => c.table === 'feeding_entries')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `gte:at=${cutoff48h}`,
    ])
    expect(calls.find((c) => c.table === 'diaper_entries')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `gte:at=${cutoff48h}`,
    ])
    expect(calls.find((c) => c.table === 'sticker_categories')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'is:archived_at=null', 'order:sort_order:asc',
    ])
    expect(calls.find((c) => c.table === 'sticker_entries')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `gte:at=${cutoff8d}`,
    ])
    expect(calls.find((c) => c.table === 'routines')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'order:sort_order:asc',
    ])
    expect(calls.find((c) => c.table === 'routine_progress')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'eq:day=2026-09-14',
    ])
    expect(calls.find((c) => c.table === 'routine_day_overrides')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'eq:day=2026-09-14',
    ])
    expect(calls.find((c) => c.table === 'jots')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'is:done_at=null',
    ])
    expect(calls.find((c) => c.table === 'grocery_items')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', `or:checked_at.is.null,checked_at.gte.${cutoff24h}`,
    ])
    expect(calls.find((c) => c.table === 'sitter_sessions')?.ops).toEqual([
      'select:*', 'eq:household_id=h1', 'is:ended_at=null', 'order:started_at:desc', 'limit:1', 'maybeSingle',
    ])
  })

  it('rejects with the query error message', async () => {
    const { client } = createFakeClient({
      ...baseTableData(),
      medicines: { data: null, error: { message: 'boom' } },
    })
    const source = createSupabaseSource(client)
    await expect(source.load('h1', now)).rejects.toThrow('boom')
  })

  it('rejects when the households query itself errors', async () => {
    const { client } = createFakeClient({
      ...baseTableData(),
      households: { data: null, error: { message: 'household not found' } },
    })
    const source = createSupabaseSource(client)
    await expect(source.load('h1', now)).rejects.toThrow('household not found')
  })

  describe('multiple open sitter sessions', () => {
    it('picks the most recently started open session when more than one is open', async () => {
      // A real query orders by started_at desc and limits to 1, so the fake's data is
      // already in that shape here — the query-shape assertion above covers the ordering.
      const mostRecent = {
        id: 'sess-2', household_id: 'h1', display_id: null, sitter_name: 'Priya',
        started_at: '2026-09-14T18:00:00Z', ended_at: null, summary_shown_at: null,
      }
      const { client } = createFakeClient({
        ...baseTableData(),
        sitter_sessions: { data: [mostRecent], error: null },
      })
      const source = createSupabaseSource(client)
      const snapshot = await source.load('h1', now)

      expect(snapshot.activeSitterSession).toEqual({
        id: 'sess-2', sitterName: 'Priya', startedAt: '2026-09-14T18:00:00Z', endedAt: null,
      })
    })
  })

  describe('conflict doses never age out', () => {
    const doseRow = (over: Record<string, unknown>) => ({
      id: 'd0', household_id: 'h1', child_id: 'c1', medicine_id: 'm1',
      at: '2026-09-14T17:00:00Z', note: null, logged_offline: false, warnings_confirmed: [],
      conflict_acknowledged_at: null, conflict_acknowledged_by: null, voided_at: null,
      voided_by: null, void_reason: null, display_id: null, logged_by_membership_id: null,
      sitter_session_id: null, logged_by_name: 'Alex', created_at: '2026-09-14T17:00:00Z',
      updated_at: '2026-09-14T17:00:00Z',
      ...over,
    })

    it('always issues a second query for unacknowledged, non-voided offline doses of any age', async () => {
      const { client, calls } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      await source.load('h1', now)

      const doseCalls = calls.filter((c) => c.table === 'dose_entries')
      expect(doseCalls).toHaveLength(2)
      expect(doseCalls[1]?.ops).toEqual([
        'select:*', 'eq:household_id=h1', 'eq:logged_offline=true',
        'is:voided_at=null', 'is:conflict_acknowledged_at=null',
      ])
    })

    it('merges the 48h window with far-older conflict doses and their ±72h context, by id', async () => {
      const oldConflict = doseRow({ id: 'd-old', at: '2026-01-01T00:00:00Z', logged_offline: true })
      // Within 72h of oldConflict; a real query would return this from the ±72h window
      // and NOT a dose outside that window, which is why we assert the query's own
      // gte/lte bounds below rather than filtering client-side in this fake.
      const neighbor = doseRow({ id: 'd-neighbor', at: '2026-01-02T12:00:00Z' })
      const recent = doseRow({ id: 'd-recent', at: now.toISOString() })

      const { client, calls } = createFakeClient({
        ...baseTableData(),
        dose_entries: [
          { data: [recent], error: null },
          { data: [oldConflict], error: null },
          { data: [oldConflict, neighbor], error: null },
        ],
      })
      const source = createSupabaseSource(client)
      const snapshot = await source.load('h1', now)

      expect(snapshot.doses.map((d) => d.id).sort()).toEqual(['d-neighbor', 'd-old', 'd-recent'])

      const windowStart = new Date(Date.parse(oldConflict.at) - 72 * 3_600_000).toISOString()
      const windowEnd = new Date(Date.parse(oldConflict.at) + 72 * 3_600_000).toISOString()
      const doseCalls = calls.filter((c) => c.table === 'dose_entries')
      expect(doseCalls).toHaveLength(3)
      expect(doseCalls[2]?.ops).toEqual([
        'select:*', 'eq:household_id=h1', `gte:at=${windowStart}`, `lte:at=${windowEnd}`,
      ])
    })

    it('does not duplicate a dose returned by more than one of the three queries', async () => {
      const shared = doseRow({ id: 'd-shared', at: '2026-01-01T00:00:00Z', logged_offline: true })
      const { client } = createFakeClient({
        ...baseTableData(),
        dose_entries: [
          { data: [shared], error: null },
          { data: [shared], error: null },
          { data: [shared], error: null },
        ],
      })
      const source = createSupabaseSource(client)
      const snapshot = await source.load('h1', now)
      expect(snapshot.doses).toHaveLength(1)
    })
  })

  describe('archived medicines', () => {
    const medicineRow = (over: Record<string, unknown>) => ({
      id: 'm1', household_id: 'h1', child_id: 'c1', name: 'Infant ibuprofen',
      min_interval_hours: 6, max_doses_per_24h: 4, archived_at: null, created_at: '2026-01-01T00:00:00Z',
      ...over,
    })
    const doseRow = (over: Record<string, unknown>) => ({
      id: 'd1', household_id: 'h1', child_id: 'c1', medicine_id: 'm1',
      at: '2026-09-14T17:00:00Z', note: null, logged_offline: false, warnings_confirmed: [],
      conflict_acknowledged_at: null, conflict_acknowledged_by: null, voided_at: null,
      voided_by: null, void_reason: null, display_id: null, logged_by_membership_id: null,
      sitter_session_id: null, logged_by_name: 'Alex', created_at: '2026-09-14T17:00:00Z',
      updated_at: '2026-09-14T17:00:00Z',
      ...over,
    })

    it('does not issue a second query when no dose references a medicine missing from the active list', async () => {
      const { client, calls } = createFakeClient({
        ...baseTableData(),
        medicines: { data: [medicineRow({})], error: null },
        dose_entries: { data: [doseRow({ medicine_id: 'm1' })], error: null },
      })
      const source = createSupabaseSource(client)
      const snapshot = await source.load('h1', now)

      expect(snapshot.medicines).toHaveLength(1)
      expect(calls.filter((c) => c.table === 'medicines')).toHaveLength(1)
    })

    it('queries by id for an archived medicine referenced by a loaded dose, and merges it in', async () => {
      const archived = medicineRow({ id: 'm-archived', name: 'Old ibuprofen', archived_at: '2026-06-01T00:00:00Z' })
      const { client, calls } = createFakeClient({
        ...baseTableData(),
        medicines: [
          { data: [], error: null },
          { data: [archived], error: null },
        ],
        dose_entries: { data: [doseRow({ id: 'd1', medicine_id: 'm-archived' })], error: null },
      })
      const source = createSupabaseSource(client)
      const snapshot = await source.load('h1', now)

      expect(snapshot.medicines).toEqual([
        { id: 'm-archived', childId: 'c1', name: 'Old ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 },
      ])
      const medicineCalls = calls.filter((c) => c.table === 'medicines')
      expect(medicineCalls).toHaveLength(2)
      expect(medicineCalls[1]?.ops).toEqual(['select:*', 'in:id=m-archived'])
    })
  })
})

describe('createSupabaseSource subscribe', () => {
  it('registers postgres_changes for every published household table with the right filters', () => {
    const { client, channels } = createFakeClient(baseTableData())
    const source = createSupabaseSource(client)
    source.subscribe('h1', () => {})

    expect(channels).toHaveLength(1)
    const [chan] = channels
    expect(chan!.name).toBe('household:h1')

    const byTable = new Map(chan!.registrations.map((r) => [r.table, r.filter]))
    expect(byTable.get('households')).toBe('id=eq.h1')
    for (const table of [
      'memberships', 'medicines', 'dose_entries', 'sleep_entries', 'feeding_entries',
      'diaper_entries', 'sticker_categories', 'sticker_entries', 'routines', 'routine_progress',
      'routine_day_overrides', 'jots', 'grocery_items', 'sitter_sessions',
    ]) {
      expect(byTable.get(table)).toBe(`household_id=eq.h1`)
    }
    for (const table of ['children', 'child_households', 'feature_overrides']) {
      expect(byTable.has(table)).toBe(true)
      expect(byTable.get(table)).toBeUndefined()
    }
  })

  it('removes the channel when unsubscribed', () => {
    const { client, channels, removeChannel } = createFakeClient(baseTableData())
    const source = createSupabaseSource(client)
    const unsubscribe = source.subscribe('h1', () => {})
    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channels[0])
  })

  describe('debouncing', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('calls onChange once for multiple change events within 300ms', () => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      const onChange = vi.fn()
      source.subscribe('h1', onChange)

      const [chan] = channels
      chan!.registrations[0]!.callback()
      vi.advanceTimersByTime(100)
      chan!.registrations[1]!.callback()
      vi.advanceTimersByTime(100)
      chan!.registrations[2]!.callback()
      vi.advanceTimersByTime(300)

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('calls onChange again for events after the debounce window elapses', () => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      const onChange = vi.fn()
      source.subscribe('h1', onChange)

      const [chan] = channels
      chan!.registrations[0]!.callback()
      vi.advanceTimersByTime(300)
      chan!.registrations[0]!.callback()
      vi.advanceTimersByTime(300)

      expect(onChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('connection status', () => {
    it('reports connected on SUBSCRIBED, without reloading the first time', () => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      const onChange = vi.fn()
      const onStatus = vi.fn()
      source.subscribe('h1', onChange, onStatus)

      channels[0]!.statusCallback?.('SUBSCRIBED')

      expect(onStatus).toHaveBeenCalledWith('connected')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('reloads on a reconnect (a second SUBSCRIBED), since events may have been missed', () => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      const onChange = vi.fn()
      const onStatus = vi.fn()
      source.subscribe('h1', onChange, onStatus)

      channels[0]!.statusCallback?.('SUBSCRIBED')
      channels[0]!.statusCallback?.('CHANNEL_ERROR')
      channels[0]!.statusCallback?.('SUBSCRIBED')

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onStatus).toHaveBeenNthCalledWith(1, 'connected')
      expect(onStatus).toHaveBeenNthCalledWith(2, 'disconnected')
      expect(onStatus).toHaveBeenNthCalledWith(3, 'connected')
    })

    it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('reports disconnected on %s', (status) => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      const onStatus = vi.fn()
      source.subscribe('h1', () => {}, onStatus)

      channels[0]!.statusCallback?.(status)

      expect(onStatus).toHaveBeenCalledWith('disconnected')
    })

    it('works without an onStatus callback', () => {
      const { client, channels } = createFakeClient(baseTableData())
      const source = createSupabaseSource(client)
      source.subscribe('h1', () => {})

      expect(() => channels[0]!.statusCallback?.('SUBSCRIBED')).not.toThrow()
    })
  })
})
