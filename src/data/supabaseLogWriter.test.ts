import { describe, expect, it } from 'vitest'
import type { RoostClient } from './supabase'
import { createSupabaseLogWriter, isRetryableWriteError } from './supabaseLogWriter'
import { LogWriteError } from './logWriter'
import type { Attribution, LogCommand } from './logCommands'

interface RecordedCall {
  table?: string
  op: string
  payload?: unknown
  options?: unknown
  eq?: [string, unknown]
  select?: string
  name?: string
  args?: unknown
}

type Resp = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

function createFakeClient(opts: { responses?: Record<string, Resp>; throwOn?: Set<string>; session?: boolean } = {}) {
  const calls: RecordedCall[] = []
  const auth = {
    async getSession() {
      return { data: { session: opts.session === false ? null : { access_token: 't' } }, error: null }
    },
  }

  /** `rows` is the default `data` for a successful update/delete ... select('id'): the one matched row. */
  function resultFor(key: string, rows?: unknown[]): Promise<Resp> {
    if (opts.throwOn?.has(key)) return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(opts.responses?.[key] ?? (rows ? { error: null, data: rows } : { error: null }))
  }

  function from(table: string) {
    return {
      upsert(payload: unknown, options?: unknown) {
        calls.push({ table, op: 'upsert', payload, options })
        return resultFor(`${table}.upsert`)
      },
      update(payload: unknown) {
        const call: RecordedCall = { table, op: 'update', payload }
        calls.push(call)
        return {
          eq(col: string, val: unknown) {
            call.eq = [col, val]
            return {
              select(columns: string) {
                call.select = columns
                return resultFor(`${table}.update`, [{ id: val }])
              },
            }
          },
        }
      },
      delete() {
        const call: RecordedCall = { table, op: 'delete' }
        calls.push(call)
        return {
          eq(col: string, val: unknown) {
            call.eq = [col, val]
            return {
              select(columns: string) {
                call.select = columns
                return resultFor(`${table}.delete`, [{ id: val }])
              },
            }
          },
        }
      },
    }
  }

  function rpc(name: string, args?: unknown) {
    calls.push({ op: 'rpc', name, args })
    return resultFor(`rpc.${name}`)
  }

  const client = { from, rpc, auth } as unknown as RoostClient
  return { client, calls }
}

const householdId = 'aaaaaaaa-0000-0000-0000-000000000001'
const childId = 'cccccccc-0000-0000-0000-000000000001'

const attribution: Attribution = {
  displayId: 'demo-display',
  loggedByMembershipId: 'bbbbbbbb-0000-0000-0000-000000000001',
  sitterSessionId: null,
  loggedByName: 'Sam',
}

describe('createSupabaseLogWriter', () => {
  describe('inserts (upsert with onConflict/ignoreDuplicates)', () => {
    it('sleep.start', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sleep-1', childId, startAt: '2026-09-14T19:00:00Z', endAt: null, type: 'nap' as const }
      await writer.execute({ kind: 'sleep.start', householdId, entry, attribution })

      expect(calls).toEqual([
        {
          table: 'sleep_entries',
          op: 'upsert',
          payload: {
            id: 'sleep-1',
            household_id: householdId,
            child_id: childId,
            start_at: '2026-09-14T19:00:00Z',
            end_at: null,
            type: 'nap',
            display_id: 'demo-display',
            logged_by_membership_id: attribution.loggedByMembershipId,
            sitter_session_id: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('sleep.restore (same shape as sleep.start)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sleep-1', childId, startAt: '2026-09-14T19:00:00Z', endAt: '2026-09-14T20:00:00Z', type: 'night' as const }
      await writer.execute({ kind: 'sleep.restore', householdId, entry, attribution })

      expect(calls[0]).toMatchObject({ table: 'sleep_entries', op: 'upsert', options: { onConflict: 'id', ignoreDuplicates: true } })
      expect((calls[0]?.payload as Record<string, unknown>).end_at).toBe('2026-09-14T20:00:00Z')
    })

    it('feeding.add', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'feed-1', childId, at: '2026-09-14T19:00:00Z', type: 'milk' as const, amount: '4 oz', note: null }
      await writer.execute({ kind: 'feeding.add', householdId, entry, attribution })

      expect(calls).toEqual([
        {
          table: 'feeding_entries',
          op: 'upsert',
          payload: {
            id: 'feed-1',
            household_id: householdId,
            child_id: childId,
            at: '2026-09-14T19:00:00Z',
            type: 'milk',
            amount: '4 oz',
            note: null,
            display_id: 'demo-display',
            logged_by_membership_id: attribution.loggedByMembershipId,
            sitter_session_id: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('sticker.add', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sticker-1', childId, categoryId: 'cat-1', at: '2026-09-14T19:00:00Z' }
      await writer.execute({ kind: 'sticker.add', householdId, entry, attribution })

      expect(calls).toEqual([
        {
          table: 'sticker_entries',
          op: 'upsert',
          payload: {
            id: 'sticker-1',
            household_id: householdId,
            child_id: childId,
            category_id: 'cat-1',
            at: '2026-09-14T19:00:00Z',
            display_id: 'demo-display',
            logged_by_membership_id: attribution.loggedByMembershipId,
            sitter_session_id: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('diaper.add (kind column)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'diaper-1', childId, at: '2026-09-14T19:00:00Z', kind: 'wet' as const }
      await writer.execute({ kind: 'diaper.add', householdId, entry, attribution })

      expect(calls).toEqual([
        {
          table: 'diaper_entries',
          op: 'upsert',
          payload: {
            id: 'diaper-1',
            household_id: householdId,
            child_id: childId,
            at: '2026-09-14T19:00:00Z',
            kind: 'wet',
            display_id: 'demo-display',
            logged_by_membership_id: attribution.loggedByMembershipId,
            sitter_session_id: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('dose.add (medicine_id, at, note, logged_offline, warnings_confirmed)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = {
        id: 'dose-1', childId, medicineId: 'med-1', at: '2026-09-14T19:00:00Z',
        loggedByName: null, loggedOffline: true, voidedAt: null, conflictAcknowledgedAt: null,
        createdAt: '2026-09-14T19:00:00Z', note: '5 ml', warningsConfirmed: ['early'],
      }
      await writer.execute({ kind: 'dose.add', householdId, entry, attribution })

      expect(calls).toEqual([
        {
          table: 'dose_entries',
          op: 'upsert',
          payload: {
            id: 'dose-1',
            household_id: householdId,
            child_id: childId,
            medicine_id: 'med-1',
            at: '2026-09-14T19:00:00Z',
            note: '5 ml',
            logged_offline: true,
            warnings_confirmed: ['early'],
            display_id: 'demo-display',
            logged_by_membership_id: attribution.loggedByMembershipId,
            sitter_session_id: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('jot.add (text, display_id)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const jot = { id: 'jot-1', text: 'Remember this', createdAt: '2026-09-14T19:00:00Z', doneAt: null }
      await writer.execute({ kind: 'jot.add', householdId, jot, displayId: 'demo-display' })

      expect(calls).toEqual([
        {
          table: 'jots',
          op: 'upsert',
          payload: {
            id: 'jot-1', household_id: householdId, text: 'Remember this', display_id: 'demo-display',
            created_at: '2026-09-14T19:00:00Z', done_at: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('grocery.add', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }
      await writer.execute({ kind: 'grocery.add', householdId, item, displayId: 'demo-display' })

      expect(calls).toEqual([
        {
          table: 'grocery_items',
          op: 'upsert',
          payload: {
            id: 'grocery-1', household_id: householdId, text: 'Milk', display_id: 'demo-display',
            created_at: '2026-09-14T19:00:00Z', checked_at: null,
          },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })

    it('routine.step -> set_routine_step RPC, so the server adds or removes the one step (no lost updates)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'routine.step', householdId, childId, routineId: 'routine-1', day: '2026-09-14', stepIndex: 2, done: true })
      await writer.execute({ kind: 'routine.step', householdId, childId, routineId: 'routine-1', day: '2026-09-14', stepIndex: 2, done: false })

      expect(calls).toEqual([
        {
          op: 'rpc',
          name: 'set_routine_step',
          args: { p_child_id: childId, p_routine_id: 'routine-1', p_day: '2026-09-14', p_step_index: 2, p_done: true },
        },
        {
          op: 'rpc',
          name: 'set_routine_step',
          args: { p_child_id: childId, p_routine_id: 'routine-1', p_day: '2026-09-14', p_step_index: 2, p_done: false },
        },
      ])
    })
  })

  describe('restores keep the original timestamps', () => {
    it('grocery.add restoring a deleted checked item sends its created_at and checked_at', async () => {
      const { client, calls } = createFakeClient()
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-10T08:00:00Z', checkedAt: '2026-09-11T09:30:00Z' }
      await createSupabaseLogWriter(client).execute({ kind: 'grocery.add', householdId, item, displayId: null })

      expect(calls[0]?.payload).toMatchObject({ created_at: '2026-09-10T08:00:00Z', checked_at: '2026-09-11T09:30:00Z' })
    })

    it('jot.add sends its created_at and done_at', async () => {
      const { client, calls } = createFakeClient()
      const jot = { id: 'jot-1', text: 'x', createdAt: '2026-09-10T08:00:00Z', doneAt: '2026-09-12T08:00:00Z' }
      await createSupabaseLogWriter(client).execute({ kind: 'jot.add', householdId, jot, displayId: null })

      expect(calls[0]?.payload).toMatchObject({ created_at: '2026-09-10T08:00:00Z', done_at: '2026-09-12T08:00:00Z' })
    })
  })

  describe('updates', () => {
    it('sleep.end -> sleep_entries.update({ end_at }).eq(id, entryId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'sleep.end', householdId, entryId: 'sleep-1', endAt: '2026-09-14T20:00:00Z', previousEndAt: null })

      expect(calls).toEqual([
        { table: 'sleep_entries', op: 'update', payload: { end_at: '2026-09-14T20:00:00Z' }, eq: ['id', 'sleep-1'], select: 'id' },
      ])
    })

    it('grocery.check -> grocery_items.update({ checked_at }).eq(id, itemId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'grocery.check', householdId, itemId: 'grocery-1', checkedAt: '2026-09-14T20:00:00Z', previousCheckedAt: null })

      expect(calls).toEqual([
        { table: 'grocery_items', op: 'update', payload: { checked_at: '2026-09-14T20:00:00Z' }, eq: ['id', 'grocery-1'], select: 'id' },
      ])
    })
  })

  describe('updates and deletes that match no row', () => {
    async function errorFrom(p: Promise<void>): Promise<LogWriteError> {
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LogWriteError)
      return err as LogWriteError
    }

    it('sleep.end matching 0 rows throws a retryable NOT_FOUND (the start may not have synced yet)', async () => {
      const { client } = createFakeClient({ responses: { 'sleep_entries.update': { error: null, data: [] } } })
      const err = await errorFrom(
        createSupabaseLogWriter(client).execute({ kind: 'sleep.end', householdId, entryId: 'sleep-1', endAt: '2026-09-14T20:00:00Z', previousEndAt: null }),
      )
      expect(err.message).toBe('Not found yet')
      expect(err.network).toBe(true)
      expect(err.code).toBe('NOT_FOUND')
    })

    it('grocery.check matching 0 rows throws a retryable NOT_FOUND', async () => {
      const { client } = createFakeClient({ responses: { 'grocery_items.update': { error: null, data: [] } } })
      const err = await errorFrom(
        createSupabaseLogWriter(client).execute({ kind: 'grocery.check', householdId, itemId: 'g1', checkedAt: null, previousCheckedAt: '2026-09-14T20:00:00Z' }),
      )
      expect(err.network).toBe(true)
      expect(err.code).toBe('NOT_FOUND')
    })

    it('deletes matching 0 rows succeed: the row is already gone', async () => {
      const { client } = createFakeClient({
        responses: {
          'sleep_entries.delete': { error: null, data: [] },
          'jots.delete': { error: null, data: [] },
          'grocery_items.delete': { error: null, data: [] },
        },
      })
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sleep-1', childId, startAt: '2026-09-14T19:00:00Z', endAt: null, type: 'nap' as const }
      await expect(writer.execute({ kind: 'sleep.discard', householdId, entry, attribution })).resolves.toBeUndefined()
      await expect(writer.execute({ kind: 'entry.delete', householdId, table: 'jots', entryId: 'jot-1' })).resolves.toBeUndefined()
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }
      await expect(writer.execute({ kind: 'grocery.delete', householdId, item, displayId: null })).resolves.toBeUndefined()
    })
  })

  describe('deletes', () => {
    it('sleep.discard -> sleep_entries.delete().eq(id, entry.id)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sleep-1', childId, startAt: '2026-09-14T19:00:00Z', endAt: null, type: 'nap' as const }
      await writer.execute({ kind: 'sleep.discard', householdId, entry, attribution })

      expect(calls).toEqual([{ table: 'sleep_entries', op: 'delete', eq: ['id', 'sleep-1'], select: 'id' }])
    })

    it('entry.delete -> <table>.delete().eq(id, entryId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'entry.delete', householdId, table: 'jots', entryId: 'jot-1' })

      expect(calls).toEqual([{ table: 'jots', op: 'delete', eq: ['id', 'jot-1'], select: 'id' }])
    })

    it('grocery.delete -> grocery_items.delete().eq(id, item.id)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }
      await writer.execute({ kind: 'grocery.delete', householdId, item, displayId: 'demo-display' })

      expect(calls).toEqual([{ table: 'grocery_items', op: 'delete', eq: ['id', 'grocery-1'], select: 'id' }])
    })
  })

  describe('RPCs', () => {
    it('dose.void', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'dose.void', householdId, doseId: 'dose-1', membershipId: 'mem-1', pin: '1234', reason: 'oops' })

      expect(calls).toEqual([
        { op: 'rpc', name: 'void_dose', args: { p_dose_id: 'dose-1', p_membership_id: 'mem-1', p_pin: '1234', p_reason: 'oops' } },
      ])
    })

    it('dose.acknowledge', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'dose.acknowledge', householdId, doseId: 'dose-1', membershipId: 'mem-1', pin: '1234' })

      expect(calls).toEqual([
        { op: 'rpc', name: 'acknowledge_dose_conflict', args: { p_dose_id: 'dose-1', p_membership_id: 'mem-1', p_pin: '1234' } },
      ])
    })

    it('dinner.set sends the text', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'dinner.set', householdId, text: 'Tacos', previous: null })

      expect(calls).toEqual([{ op: 'rpc', name: 'set_dinner_tonight', args: { p_household_id: householdId, p_text: 'Tacos' } }])
    })

    it('dinner.set sends empty string when text is null', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'dinner.set', householdId, text: null, previous: 'Tacos' })

      expect(calls).toEqual([{ op: 'rpc', name: 'set_dinner_tonight', args: { p_household_id: householdId, p_text: '' } }])
    })

    it('verifyPin calls verify_pin and returns the boolean', async () => {
      const { client } = createFakeClient({ responses: { 'rpc.verify_pin': { error: null, data: true } } })
      const writer = createSupabaseLogWriter(client)
      await expect(writer.verifyPin('mem-1', '1234')).resolves.toBe(true)
    })

    it('verifyPin returns false when the server says so', async () => {
      const { client } = createFakeClient({ responses: { 'rpc.verify_pin': { error: null, data: false } } })
      const writer = createSupabaseLogWriter(client)
      await expect(writer.verifyPin('mem-1', '0000')).resolves.toBe(false)
    })
  })

  describe('retryable vs permanent classification', () => {
    const cases: Array<{ name: string; status: number | null; code: string | null; hasSession: boolean; retryable: boolean }> = [
      { name: 'fetch failure (no status, no code)', status: null, code: null, hasSession: true, retryable: true },
      { name: 'fetch failure (status 0, empty code)', status: 0, code: '', hasSession: true, retryable: true },
      { name: '401 expired JWT', status: 401, code: 'PGRST301', hasSession: true, retryable: true },
      { name: '408 timeout', status: 408, code: null, hasSession: true, retryable: true },
      { name: '429 rate limited', status: 429, code: null, hasSession: true, retryable: true },
      { name: '500 with a Postgres code', status: 500, code: 'XX000', hasSession: true, retryable: true },
      { name: '503 unavailable', status: 503, code: null, hasSession: true, retryable: true },
      { name: 'PGRST3xx JWT error without a status', status: null, code: 'PGRST303', hasSession: true, retryable: true },
      { name: '42501 without a user session', status: 401, code: '42501', hasSession: false, retryable: true },
      { name: '42501 without a user session (403)', status: 403, code: '42501', hasSession: false, retryable: true },
      { name: '42501 with a session (RLS says no)', status: 403, code: '42501', hasSession: true, retryable: false },
      { name: '23514 check violation', status: 400, code: '23514', hasSession: true, retryable: false },
      { name: '23503 foreign key', status: 409, code: '23503', hasSession: true, retryable: false },
      { name: '22P02 invalid input', status: 400, code: '22P02', hasSession: true, retryable: false },
      { name: 'P0001 raised exception', status: 400, code: 'P0001', hasSession: true, retryable: false },
      { name: 'PGRST116 (PostgREST 1xx)', status: 406, code: 'PGRST116', hasSession: true, retryable: false },
      { name: 'PGRST204 (PostgREST 2xx)', status: 400, code: 'PGRST204', hasSession: true, retryable: false },
      { name: '404 with no code', status: 404, code: null, hasSession: true, retryable: false },
    ]

    it.each(cases)('$name -> retryable=$retryable', ({ status, code, hasSession, retryable }) => {
      expect(isRetryableWriteError({ status, code, hasSession })).toBe(retryable)
    })

    it('execute maps a 401 JWT error to network=true with its status', async () => {
      const { client } = createFakeClient({
        responses: { 'rpc.set_dinner_tonight': { error: { message: 'JWT expired', code: 'PGRST303' }, status: 401 } },
      })
      const err = await createSupabaseLogWriter(client).execute({ kind: 'dinner.set', householdId, text: 'x', previous: null }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).network).toBe(true)
      expect((err as LogWriteError).status).toBe(401)
      expect((err as LogWriteError).code).toBe('PGRST303')
    })

    it('execute maps 42501 to network=true when the client has no session, network=false when it does', async () => {
      const responses = { 'rpc.set_dinner_tonight': { error: { message: 'permission denied', code: '42501' }, status: 403 } }
      const cmd: LogCommand = { kind: 'dinner.set', householdId, text: 'x', previous: null }

      const noSession = createFakeClient({ responses, session: false })
      const e1 = await createSupabaseLogWriter(noSession.client).execute(cmd).catch((e: unknown) => e)
      expect((e1 as LogWriteError).network).toBe(true)

      const withSession = createFakeClient({ responses, session: true })
      const e2 = await createSupabaseLogWriter(withSession.client).execute(cmd).catch((e: unknown) => e)
      expect((e2 as LogWriteError).network).toBe(false)
    })

    it('execute maps a 400 check violation to network=false', async () => {
      const { client } = createFakeClient({
        responses: { 'jots.upsert': { error: { message: 'violates check', code: '23514' }, status: 400 } },
      })
      const jot = { id: 'jot-1', text: '', createdAt: '2026-09-14T19:00:00Z', doneAt: null }
      const err = await createSupabaseLogWriter(client).execute({ kind: 'jot.add', householdId, jot, displayId: null }).catch((e: unknown) => e)
      expect((err as LogWriteError).network).toBe(false)
      expect((err as LogWriteError).status).toBe(400)
    })

    it('ready() reports whether the client has a user session', async () => {
      await expect(createSupabaseLogWriter(createFakeClient({ session: true }).client).ready!()).resolves.toBe(true)
      await expect(createSupabaseLogWriter(createFakeClient({ session: false }).client).ready!()).resolves.toBe(false)
    })
  })

  describe('error mapping', () => {
    it('a Postgrest error with a non-empty code maps to network=false', async () => {
      const { client } = createFakeClient({
        responses: { 'grocery_items.delete': { error: { message: 'not found', code: 'PGRST116' } } },
      })
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }

      const err = await writer.execute({ kind: 'grocery.delete', householdId, item, displayId: null }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).network).toBe(false)
      expect((err as LogWriteError).code).toBe('PGRST116')
      expect((err as LogWriteError).message).toBe('not found')
    })

    it('a Postgrest error with an empty code maps to network=true', async () => {
      const { client } = createFakeClient({
        responses: { 'grocery_items.delete': { error: { message: 'network hiccup', code: '' } } },
      })
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }

      const err = await writer.execute({ kind: 'grocery.delete', householdId, item, displayId: null }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).network).toBe(true)
      expect((err as LogWriteError).code).toBeNull()
    })

    it('a thrown TypeError (fetch failed) maps to network=true', async () => {
      const { client } = createFakeClient({ throwOn: new Set(['grocery_items.delete']) })
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }

      const err = await writer.execute({ kind: 'grocery.delete', householdId, item, displayId: null }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).network).toBe(true)
      expect((err as LogWriteError).code).toBeNull()
    })
  })
})
