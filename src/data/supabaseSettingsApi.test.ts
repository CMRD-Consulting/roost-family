import { describe, expect, it } from 'vitest'
import type { RoostClient } from './supabase'
import { createSupabaseSettingsApi } from './supabaseSettingsApi'
import { SettingsError } from './settingsApi'

interface RpcCall {
  op: 'rpc'
  name: string
  args?: unknown
}

interface FromCall {
  op: 'from'
  table: string
  chain: unknown[][]
}

type Resp = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

function createFakeClient(opts: { rpc?: Record<string, Resp>; from?: Resp; throwOn?: Set<string> } = {}) {
  const calls: Array<RpcCall | FromCall> = []

  function rpc(name: string, args?: unknown) {
    calls.push({ op: 'rpc', name, args })
    if (opts.throwOn?.has(`rpc.${name}`)) return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(opts.rpc?.[name] ?? { error: null, data: undefined })
  }

  function from(table: string) {
    const call: FromCall = { op: 'from', table, chain: [] }
    calls.push(call)
    const builder = {
      select(columns: string) {
        call.chain.push(['select', columns])
        return builder
      },
      order(column: string, options: unknown) {
        call.chain.push(['order', column, options])
        return builder
      },
      limit(n: number) {
        call.chain.push(['limit', n])
        return builder
      },
      eq(column: string, value: unknown) {
        call.chain.push(['eq', column, value])
        return builder
      },
      lt(column: string, value: unknown) {
        call.chain.push(['lt', column, value])
        return builder
      },
      then(onFulfilled: (r: Resp) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(opts.from ?? { error: null, data: [] }).then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  const client = { from, rpc } as unknown as RoostClient
  return { client, calls }
}

const membershipId = 'bbbbbbbb-0000-0000-0000-000000000001'
const auth = { membershipId, pin: '1234' }

describe('createSupabaseSettingsApi', () => {
  describe('settingsVerify', () => {
    it('calls settings_verify and returns the role and display name', async () => {
      const { client, calls } = createFakeClient({
        rpc: { settings_verify: { error: null, data: [{ out_role: 'owner', out_display_name: 'Sam' }] } },
      })
      const result = await createSupabaseSettingsApi(client).settingsVerify(auth)
      expect(result).toEqual({ role: 'owner', displayName: 'Sam' })
      expect(calls).toEqual([{ op: 'rpc', name: 'settings_verify', args: { p_membership_id: membershipId, p_pin: '1234' } }])
    })

    it('throws SettingsError(other) when the RPC returns no row', async () => {
      const { client } = createFakeClient({ rpc: { settings_verify: { error: null, data: [] } } })
      const err = await createSupabaseSettingsApi(client).settingsVerify(auth).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SettingsError)
      expect((err as SettingsError).code).toBe('other')
    })
  })

  it('updateHouseholdSettings maps every field to its p_ argument', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).updateHouseholdSettings(auth, {
      name: 'Rivera', zip: '28202', timeZone: 'America/New_York', leaveByBufferMin: 20,
      defaultNightSleep: { start: '19:00', end: '06:00' }, nightMode: { start: '20:00', end: '06:00' }, diaperLogEnabled: true,
    })
    expect(calls).toEqual([
      {
        op: 'rpc', name: 'update_household_settings',
        args: {
          p_membership_id: membershipId, p_pin: '1234', p_name: 'Rivera', p_zip: '28202', p_time_zone: 'America/New_York',
          p_leave_by_buffer_min: 20, p_default_night_start: '19:00', p_default_night_end: '06:00',
          p_night_mode_start: '20:00', p_night_mode_end: '06:00', p_diaper_log_enabled: true,
        },
      },
    ])
  })

  it('updateHouseholdSettings sends a null zip through unchanged', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).updateHouseholdSettings(auth, {
      name: 'Rivera', zip: null, timeZone: 'America/New_York', leaveByBufferMin: 20,
      defaultNightSleep: { start: '19:00', end: '06:00' }, nightMode: { start: '20:00', end: '06:00' }, diaperLogEnabled: false,
    })
    expect((calls[0] as RpcCall).args).toMatchObject({ p_zip: null })
  })

  it('updateSitterInfo sends the info object as p_info', async () => {
    const { client, calls } = createFakeClient()
    const info = { napInstructions: 'Crib, sound machine' }
    await createSupabaseSettingsApi(client).updateSitterInfo(auth, info)
    expect(calls).toEqual([{ op: 'rpc', name: 'update_sitter_info', args: { p_membership_id: membershipId, p_pin: '1234', p_info: info } }])
  })

  it('addChild -> add_child_pin, returns the new id', async () => {
    const { client, calls } = createFakeClient({ rpc: { add_child_pin: { error: null, data: 'child-1' } } })
    const id = await createSupabaseSettingsApi(client).addChild(auth, { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' })
    expect(id).toBe('child-1')
    expect(calls).toEqual([
      { op: 'rpc', name: 'add_child_pin', args: { p_membership_id: membershipId, p_pin: '1234', p_name: 'Ivy', p_birthday: '2023-04-10', p_color: '#C2477A' } },
    ])
  })

  it('updateChild sends both night times as null when clearing the override', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).updateChild(auth, {
      childId: 'child-1', name: 'Ivy', birthday: '2023-04-10', color: '#C2477A', allergies: 'Peanuts', foodRules: '', nightSleep: null,
    })
    expect(calls).toEqual([
      {
        op: 'rpc', name: 'update_child',
        args: {
          p_membership_id: membershipId, p_pin: '1234', p_child_id: 'child-1', p_name: 'Ivy', p_birthday: '2023-04-10',
          p_color: '#C2477A', p_allergies: 'Peanuts', p_food_rules: '', p_night_start: null, p_night_end: null,
        },
      },
    ])
  })

  it('updateChild sends both night times when a household-default override is set', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).updateChild(auth, {
      childId: 'child-1', name: 'Ivy', birthday: '2023-04-10', color: '#C2477A', allergies: '', foodRules: '',
      nightSleep: { start: '19:30', end: '06:30' },
    })
    expect((calls[0] as RpcCall).args).toMatchObject({ p_night_start: '19:30', p_night_end: '06:30' })
  })

  it('setFeatureOverride sends null to clear', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).setFeatureOverride(auth, 'child-1', 'kidsCorner', null)
    expect(calls).toEqual([
      { op: 'rpc', name: 'set_feature_override', args: { p_membership_id: membershipId, p_pin: '1234', p_child_id: 'child-1', p_feature: 'kidsCorner', p_enabled: null } },
    ])
  })

  it('upsertRoutine sends a null routine id for a new routine and the steps array', async () => {
    const { client, calls } = createFakeClient({ rpc: { upsert_routine: { error: null, data: 'routine-1' } } })
    const steps = [{ iconKey: 'bath', photoId: null, label: 'Bath', time: '18:15' }]
    const id = await createSupabaseSettingsApi(client).upsertRoutine(auth, {
      routineId: null, childId: 'child-1', name: 'Weekend', weekdays: [0, 6], steps,
    })
    expect(id).toBe('routine-1')
    expect(calls).toEqual([
      {
        op: 'rpc', name: 'upsert_routine',
        args: { p_membership_id: membershipId, p_pin: '1234', p_routine_id: null, p_child_id: 'child-1', p_name: 'Weekend', p_weekdays: [0, 6], p_steps: steps },
      },
    ])
  })

  it('deleteRoutine -> delete_routine', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).deleteRoutine(auth, 'routine-1')
    expect(calls).toEqual([{ op: 'rpc', name: 'delete_routine', args: { p_membership_id: membershipId, p_pin: '1234', p_routine_id: 'routine-1' } }])
  })

  it('setRoutineDayOverride sends null to clear the day override', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).setRoutineDayOverride(auth, 'child-1', '2026-09-14', null)
    expect(calls).toEqual([
      { op: 'rpc', name: 'set_routine_day_override', args: { p_membership_id: membershipId, p_pin: '1234', p_child_id: 'child-1', p_day: '2026-09-14', p_routine_id: null } },
    ])
  })

  it('upsertMedicine sends a null medicine id for a new medicine', async () => {
    const { client, calls } = createFakeClient({ rpc: { upsert_medicine: { error: null, data: 'medicine-1' } } })
    const id = await createSupabaseSettingsApi(client).upsertMedicine(auth, {
      medicineId: null, childId: 'child-1', name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4,
    })
    expect(id).toBe('medicine-1')
    expect(calls).toEqual([
      {
        op: 'rpc', name: 'upsert_medicine',
        args: { p_membership_id: membershipId, p_pin: '1234', p_medicine_id: null, p_child_id: 'child-1', p_name: 'Infant ibuprofen', p_min_interval_hours: 6, p_max_doses_per_24h: 4 },
      },
    ])
  })

  it('archiveMedicine -> archive_medicine', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).archiveMedicine(auth, 'medicine-1')
    expect(calls).toEqual([{ op: 'rpc', name: 'archive_medicine', args: { p_membership_id: membershipId, p_pin: '1234', p_medicine_id: 'medicine-1' } }])
  })

  it('upsertStickerCategory sends a null sort order to append', async () => {
    const { client, calls } = createFakeClient({ rpc: { upsert_sticker_category: { error: null, data: 'cat-1' } } })
    const id = await createSupabaseSettingsApi(client).upsertStickerCategory(auth, { categoryId: null, name: 'Potty', iconKey: 'potty', sortOrder: null })
    expect(id).toBe('cat-1')
    expect(calls).toEqual([
      {
        op: 'rpc', name: 'upsert_sticker_category',
        args: { p_membership_id: membershipId, p_pin: '1234', p_category_id: null, p_name: 'Potty', p_icon_key: 'potty', p_sort_order: null },
      },
    ])
  })

  it('archiveStickerCategory -> archive_sticker_category', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).archiveStickerCategory(auth, 'cat-1')
    expect(calls).toEqual([{ op: 'rpc', name: 'archive_sticker_category', args: { p_membership_id: membershipId, p_pin: '1234', p_category_id: 'cat-1' } }])
  })

  it('setMyColor -> set_my_color', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).setMyColor(auth, '#5B6ACF')
    expect(calls).toEqual([{ op: 'rpc', name: 'set_my_color', args: { p_membership_id: membershipId, p_pin: '1234', p_color: '#5B6ACF' } }])
  })

  it('deleteOldEntries -> delete_old_entries, returns the deleted count', async () => {
    const { client, calls } = createFakeClient({ rpc: { delete_old_entries: { error: null, data: 12 } } })
    const count = await createSupabaseSettingsApi(client).deleteOldEntries(auth, 'jots', '2024-09-14T00:00:00Z')
    expect(count).toBe(12)
    expect(calls).toEqual([
      { op: 'rpc', name: 'delete_old_entries', args: { p_membership_id: membershipId, p_pin: '1234', p_table: 'jots', p_before: '2024-09-14T00:00:00Z' } },
    ])
  })

  describe('listEntries', () => {
    it('reads the table ordered by its time column, newest first, limited', async () => {
      const rows = [{ id: 'e1', child_id: 'child-1', at: '2026-09-14T19:00:00Z', logged_by_name: 'Sam' }]
      const { client, calls } = createFakeClient({ from: { error: null, data: rows } })
      const result = await createSupabaseSettingsApi(client).listEntries({ table: 'feeding_entries', limit: 50 })

      expect(result).toEqual([{ id: 'e1', childId: 'child-1', at: '2026-09-14T19:00:00Z', loggedByName: 'Sam', row: rows[0] }])
      const call = calls[0] as FromCall
      expect(call.table).toBe('feeding_entries')
      expect(call.chain).toEqual([['select', '*'], ['order', 'at', { ascending: false }], ['limit', 50]])
    })

    it('applies childId and before filters, and uses start_at for sleep_entries', async () => {
      const { client, calls } = createFakeClient({ from: { error: null, data: [] } })
      await createSupabaseSettingsApi(client).listEntries({ table: 'sleep_entries', childId: 'child-1', before: '2026-09-14T00:00:00Z', limit: 10 })

      const call = calls[0] as FromCall
      expect(call.chain).toEqual([
        ['select', '*'], ['order', 'start_at', { ascending: false }], ['limit', 10],
        ['eq', 'child_id', 'child-1'], ['lt', 'start_at', '2026-09-14T00:00:00Z'],
      ])
    })

    it('a row with no logged_by_name maps to null', async () => {
      const rows = [{ id: 'd1', child_id: 'child-1', at: '2026-09-14T19:00:00Z' }]
      const { client } = createFakeClient({ from: { error: null, data: rows } })
      const result = await createSupabaseSettingsApi(client).listEntries({ table: 'dose_entries', limit: 5 })
      expect(result[0]?.loggedByName).toBeNull()
    })
  })

  describe('full sign-in RPCs (adult client)', () => {
    it('createMemberInvite -> create_member_invite, returns token and expiry', async () => {
      const { client, calls } = createFakeClient({
        rpc: { create_member_invite: { error: null, data: [{ out_token: 'tok', out_expires_at: '2026-09-14T20:00:00Z' }] } },
      })
      const result = await createSupabaseSettingsApi(client).createMemberInvite(client, 'household-1', 'adult')
      expect(result).toEqual({ token: 'tok', expiresAt: '2026-09-14T20:00:00Z' })
      expect(calls).toEqual([{ op: 'rpc', name: 'create_member_invite', args: { p_household_id: 'household-1', p_role: 'adult' } }])
    })

    it('acceptMemberInvite -> accept_member_invite, returns the new membership id', async () => {
      const { client, calls } = createFakeClient({ rpc: { accept_member_invite: { error: null, data: 'membership-2' } } })
      const id = await createSupabaseSettingsApi(client).acceptMemberInvite(client, { token: 'tok', displayName: 'Pat', color: '#000000', pin: '9999' })
      expect(id).toBe('membership-2')
      expect(calls).toEqual([
        { op: 'rpc', name: 'accept_member_invite', args: { p_token: 'tok', p_display_name: 'Pat', p_color: '#000000', p_pin: '9999' } },
      ])
    })

    it('setMemberRole -> set_member_role', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).setMemberRole(client, 'membership-2', 'owner')
      expect(calls).toEqual([{ op: 'rpc', name: 'set_member_role', args: { p_membership_id: 'membership-2', p_role: 'owner' } }])
    })

    it('removeMember -> remove_member', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).removeMember(client, 'membership-2')
      expect(calls).toEqual([{ op: 'rpc', name: 'remove_member', args: { p_membership_id: 'membership-2' } }])
    })

    it('leaveHousehold -> leave_household', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).leaveHousehold(client, 'household-1')
      expect(calls).toEqual([{ op: 'rpc', name: 'leave_household', args: { p_household_id: 'household-1' } }])
    })

    it('renameDisplay -> rename_display', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).renameDisplay(client, 'display-1', 'Kitchen')
      expect(calls).toEqual([{ op: 'rpc', name: 'rename_display', args: { p_display_id: 'display-1', p_name: 'Kitchen' } }])
    })

    it('deleteHousehold -> delete_household', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).deleteHousehold(client, 'household-1', 'Rivera')
      expect(calls).toEqual([{ op: 'rpc', name: 'delete_household', args: { p_household_id: 'household-1', p_confirm_name: 'Rivera' } }])
    })
  })

  describe('error mapping', () => {
    it('42501 maps to auth', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'incorrect PIN', code: '42501' }, status: 403 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#000000').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SettingsError)
      expect((err as SettingsError).code).toBe('auth')
      expect((err as SettingsError).message).toBe('incorrect PIN')
    })

    it('22023 maps to invalid', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'color must be a #RRGGBB hex value', code: '22023' }, status: 400 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, 'nope').catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('invalid')
    })

    it('a thrown fetch failure maps to network', async () => {
      const { client } = createFakeClient({ throwOn: new Set(['rpc.set_my_color']) })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#000000').catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('network')
    })

    it('a 401 with a JWT error code maps to network', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#000000').catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('network')
    })

    it('a 500 maps to network', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'server error' }, status: 500 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#000000').catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('network')
    })

    it('an unrecognized error maps to other', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'weird', code: '23505' }, status: 409 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#000000').catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('other')
    })
  })
})
