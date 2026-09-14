import { describe, expect, it } from 'vitest'
import type { RoostClient } from './supabase'
import { createSupabaseLogWriter } from './supabaseLogWriter'
import { LogWriteError } from './logWriter'
import type { Attribution, LogCommand } from './logCommands'

interface RecordedCall {
  table?: string
  op: string
  payload?: unknown
  options?: unknown
  eq?: [string, unknown]
  name?: string
  args?: unknown
}

type Resp = { error: { message: string; code?: string } | null; data?: unknown }

function createFakeClient(opts: { responses?: Record<string, Resp>; throwOn?: Set<string> } = {}) {
  const calls: RecordedCall[] = []

  function resultFor(key: string): Promise<Resp> {
    if (opts.throwOn?.has(key)) return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(opts.responses?.[key] ?? { error: null })
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
            return resultFor(`${table}.update`)
          },
        }
      },
      delete() {
        const call: RecordedCall = { table, op: 'delete' }
        calls.push(call)
        return {
          eq(col: string, val: unknown) {
            call.eq = [col, val]
            return resultFor(`${table}.delete`)
          },
        }
      },
    }
  }

  function rpc(name: string, args?: unknown) {
    calls.push({ op: 'rpc', name, args })
    return resultFor(`rpc.${name}`)
  }

  const client = { from, rpc } as unknown as RoostClient
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
          payload: { id: 'jot-1', household_id: householdId, text: 'Remember this', display_id: 'demo-display' },
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
          payload: { id: 'grocery-1', household_id: householdId, text: 'Milk', display_id: 'demo-display' },
          options: { onConflict: 'id', ignoreDuplicates: true },
        },
      ])
    })
  })

  describe('updates', () => {
    it('sleep.end -> sleep_entries.update({ end_at }).eq(id, entryId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'sleep.end', householdId, entryId: 'sleep-1', endAt: '2026-09-14T20:00:00Z', previousEndAt: null })

      expect(calls).toEqual([
        { table: 'sleep_entries', op: 'update', payload: { end_at: '2026-09-14T20:00:00Z' }, eq: ['id', 'sleep-1'] },
      ])
    })

    it('grocery.check -> grocery_items.update({ checked_at }).eq(id, itemId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'grocery.check', householdId, itemId: 'grocery-1', checkedAt: '2026-09-14T20:00:00Z', previousCheckedAt: null })

      expect(calls).toEqual([
        { table: 'grocery_items', op: 'update', payload: { checked_at: '2026-09-14T20:00:00Z' }, eq: ['id', 'grocery-1'] },
      ])
    })
  })

  describe('deletes', () => {
    it('sleep.discard -> sleep_entries.delete().eq(id, entry.id)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const entry = { id: 'sleep-1', childId, startAt: '2026-09-14T19:00:00Z', endAt: null, type: 'nap' as const }
      await writer.execute({ kind: 'sleep.discard', householdId, entry, attribution })

      expect(calls).toEqual([{ table: 'sleep_entries', op: 'delete', eq: ['id', 'sleep-1'] }])
    })

    it('entry.delete -> <table>.delete().eq(id, entryId)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      await writer.execute({ kind: 'entry.delete', householdId, table: 'jots', entryId: 'jot-1' })

      expect(calls).toEqual([{ table: 'jots', op: 'delete', eq: ['id', 'jot-1'] }])
    })

    it('grocery.delete -> grocery_items.delete().eq(id, item.id)', async () => {
      const { client, calls } = createFakeClient()
      const writer = createSupabaseLogWriter(client)
      const item = { id: 'grocery-1', text: 'Milk', createdAt: '2026-09-14T19:00:00Z', checkedAt: null }
      await writer.execute({ kind: 'grocery.delete', householdId, item, displayId: 'demo-display' })

      expect(calls).toEqual([{ table: 'grocery_items', op: 'delete', eq: ['id', 'grocery-1'] }])
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
