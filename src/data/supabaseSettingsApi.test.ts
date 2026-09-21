import { describe, expect, it, vi } from 'vitest'
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
      is(column: string, value: unknown) {
        call.chain.push(['is', column, value])
        return builder
      },
      update(values: unknown) {
        call.chain.push(['update', values])
        return builder
      },
      delete() {
        call.chain.push(['delete'])
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

  it('setHouseholdLocation -> set_household_location with the PIN and coordinates', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).setHouseholdLocation(auth, 35.23, -80.84)
    expect(calls).toEqual([{
      op: 'rpc', name: 'set_household_location', args: { p_membership_id: membershipId, p_pin: '1234', p_lat: 35.23, p_lon: -80.84 },
    }])
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

  describe('log entries (Settings > Logs and Inbox)', () => {
    it('updateEntry -> update_entry with the settings PIN and the changed columns of one entry', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).updateEntry(auth, 'sleep_entries', 's1', { startAt: '2026-09-14T13:00:00Z', endAt: null })
      expect(calls).toEqual([{
        op: 'rpc', name: 'update_entry',
        args: {
          p_membership_id: membershipId, p_pin: '1234', p_table: 'sleep_entries', p_entry_id: 's1',
          p_fields: { start_at: '2026-09-14T13:00:00Z', end_at: null },
        },
      }])
    })

    it('updateEntry maps every editable field to its column and leaves out undefined ones', async () => {
      const { client, calls } = createFakeClient()
      const api = createSupabaseSettingsApi(client)
      await api.updateEntry(auth, 'feeding_entries', 'f1', { at: '2026-09-14T12:00:00Z', type: 'meal', amount: null, note: 'Peas', kind: undefined })
      await api.updateEntry(auth, 'diaper_entries', 'd1', { kind: 'wet' })
      await api.updateEntry(auth, 'sticker_entries', 'st1', { categoryId: 'cat-2' })
      await api.updateEntry(auth, 'jots', 'j1', { text: 'Call Dr. Lee', doneAt: '2026-09-14T19:00:00Z' })
      const fields = calls.map((c) => ((c as RpcCall).args as { p_fields: unknown }).p_fields)
      expect(fields).toEqual([
        { at: '2026-09-14T12:00:00Z', type: 'meal', amount: null, note: 'Peas' },
        { kind: 'wet' },
        { category_id: 'cat-2' },
        { text: 'Call Dr. Lee', done_at: '2026-09-14T19:00:00Z' },
      ])
    })

    it('updateEntry on an entry that no longer exists is an invalid SettingsError', async () => {
      const { client } = createFakeClient({ rpc: { update_entry: { error: { message: 'entry not found', code: '22023' }, status: 400 } } })
      const err = await createSupabaseSettingsApi(client).updateEntry(auth, 'jots', 'gone', { doneAt: null }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SettingsError)
      expect(err).toMatchObject({ code: 'invalid', message: 'That entry no longer exists.' })
    })

    it('updateEntry reports a check violation (23514) as an end before the start', async () => {
      const { client } = createFakeClient({
        rpc: { update_entry: { error: { message: 'new row violates check constraint "sleep_entries_check"', code: '23514' }, status: 400 } },
      })
      const err = await createSupabaseSettingsApi(client)
        .updateEntry(auth, 'sleep_entries', 's1', { endAt: '2026-09-14T10:00:00Z' })
        .catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'invalid', message: 'The end time can’t be before the start.' })
    })

    it('updateEntry with a wrong PIN is an auth SettingsError', async () => {
      const { client } = createFakeClient({ rpc: { update_entry: { error: { message: 'incorrect PIN', code: '42501' }, status: 403 } } })
      await expect(createSupabaseSettingsApi(client).updateEntry(auth, 'jots', 'j1', { doneAt: null })).rejects.toMatchObject({ code: 'auth' })
    })

    it('deleteEntry -> delete_entry with the settings PIN', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).deleteEntry(auth, 'feeding_entries', 'f1')
      expect(calls).toEqual([{
        op: 'rpc', name: 'delete_entry',
        args: { p_membership_id: membershipId, p_pin: '1234', p_table: 'feeding_entries', p_entry_id: 'f1' },
      }])
    })

    it('deleteEntry on an entry that no longer exists is an invalid SettingsError', async () => {
      const { client } = createFakeClient({ rpc: { delete_entry: { error: { message: 'entry not found', code: '22023' }, status: 400 } } })
      const err = await createSupabaseSettingsApi(client).deleteEntry(auth, 'jots', 'gone').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SettingsError)
      expect(err).toMatchObject({ code: 'invalid', message: 'That entry no longer exists.' })
    })

    it('voidDose -> void_dose with the settings PIN and the reason', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).voidDose(auth, 'dose-1', 'Logged twice')
      expect(calls).toEqual([{
        op: 'rpc', name: 'void_dose',
        args: { p_dose_id: 'dose-1', p_membership_id: membershipId, p_pin: '1234', p_reason: 'Logged twice' },
      }])
    })
  })

  it('revokeMemberInvite -> revoke_member_invite with the token, on the display client', async () => {
    const { client, calls } = createFakeClient()
    await createSupabaseSettingsApi(client).revokeMemberInvite('invite-token')
    expect(calls).toEqual([{ op: 'rpc', name: 'revoke_member_invite', args: { p_invite_token: 'invite-token' } }])
  })

  describe('My account (full sign-in)', () => {
    it('setMyPin -> set_my_pin on the adult client', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).setMyPin(client, 'household-1', '4321')
      expect(calls).toEqual([{ op: 'rpc', name: 'set_my_pin', args: { p_household_id: 'household-1', p_pin: '4321' } }])
    })

    it("adultMembership reads the signed-in adult's current membership in the household", async () => {
      const { client, calls } = createFakeClient({ from: { error: null, data: [{ id: 'm1', role: 'owner' }] } })
      const result = await createSupabaseSettingsApi(client).adultMembership(client, 'household-1', 'user-1')
      expect(result).toEqual({ membershipId: 'm1', role: 'owner' })
      expect(calls).toEqual([{
        op: 'from', table: 'memberships',
        chain: [['select', 'id, role'], ['eq', 'household_id', 'household-1'], ['eq', 'user_id', 'user-1'], ['is', 'left_at', null], ['limit', 1]],
      }])
    })

    it("myMemberships lists the adult's current households, skipping deleted ones", async () => {
      const { client, calls } = createFakeClient({
        from: {
          error: null,
          data: [
            { id: 'm1', household_id: 'h1', role: 'owner', display_name: 'Sam', color: '#653437', households: { name: 'Rivera', time_zone: 'America/New_York' } },
            { id: 'm2', household_id: 'h2', role: 'adult', display_name: 'Sammy', color: '#2C7F8C', households: [{ name: 'Lake house', time_zone: 'America/Chicago' }] },
            { id: 'm3', household_id: 'h3', role: 'owner', display_name: 'Sam', color: '#653437', households: null },
          ],
        },
      })
      const result = await createSupabaseSettingsApi(client).myMemberships(client, 'user-1')
      expect(result).toEqual([
        { membershipId: 'm1', householdId: 'h1', householdName: 'Rivera', timeZone: 'America/New_York', role: 'owner', displayName: 'Sam', color: '#653437' },
        { membershipId: 'm2', householdId: 'h2', householdName: 'Lake house', timeZone: 'America/Chicago', role: 'adult', displayName: 'Sammy', color: '#2C7F8C' },
      ])
      expect(calls).toEqual([{
        op: 'from', table: 'memberships',
        chain: [
          ['select', 'id, household_id, role, display_name, color, households(name, time_zone)'],
          ['eq', 'user_id', 'user-1'], ['is', 'left_at', null], ['order', 'joined_at', { ascending: true }],
        ],
      }])
    })

    it('adultMembership is null when the adult is not a member', async () => {
      const { client } = createFakeClient({ from: { error: null, data: [] } })
      await expect(createSupabaseSettingsApi(client).adultMembership(client, 'household-1', 'user-1')).resolves.toBeNull()
    })
  })

  describe('PIN-authorised owner RPCs (a display)', () => {
    const AUTH = { membershipId: 'membership-1', pin: '1234' }

    it('createMemberInvitePin -> create_member_invite_pin, returns token and expiry', async () => {
      const { client, calls } = createFakeClient({
        rpc: { create_member_invite_pin: { error: null, data: [{ out_token: 'tok', out_expires_at: '2026-09-14T20:00:00Z' }] } },
      })
      const result = await createSupabaseSettingsApi(client).createMemberInvitePin(AUTH, 'adult')
      expect(result).toEqual({ token: 'tok', expiresAt: '2026-09-14T20:00:00Z' })
      expect(calls).toEqual([
        { op: 'rpc', name: 'create_member_invite_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_role: 'adult' } },
      ])
    })

    it('revokeMemberInvitePin -> revoke_member_invite_pin', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).revokeMemberInvitePin(AUTH, 'tok')
      expect(calls).toEqual([
        { op: 'rpc', name: 'revoke_member_invite_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_invite_token: 'tok' } },
      ])
    })

    it('setMemberRolePin -> set_member_role_pin, with the acting membership and the target apart', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).setMemberRolePin(AUTH, 'membership-2', 'owner')
      expect(calls).toEqual([
        { op: 'rpc', name: 'set_member_role_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_target_id: 'membership-2', p_role: 'owner' } },
      ])
    })

    it('removeMemberPin -> remove_member_pin', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).removeMemberPin(AUTH, 'membership-2')
      expect(calls).toEqual([
        { op: 'rpc', name: 'remove_member_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_target_id: 'membership-2' } },
      ])
    })

    it('renameDisplayPin -> rename_display_pin', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).renameDisplayPin(AUTH, 'display-1', 'Kitchen')
      expect(calls).toEqual([
        { op: 'rpc', name: 'rename_display_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_display_id: 'display-1', p_name: 'Kitchen' } },
      ])
    })

    it('revokeDisplayPin -> revoke_display_pin', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).revokeDisplayPin(AUTH, 'display-1')
      expect(calls).toEqual([
        { op: 'rpc', name: 'revoke_display_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_display_id: 'display-1' } },
      ])
    })

    it('signOutDisplayPin -> sign_out_display_pin: the PIN only, the server knows which display is calling', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).signOutDisplayPin(AUTH)
      expect(calls).toEqual([{ op: 'rpc', name: 'sign_out_display_pin', args: { p_membership_id: 'membership-1', p_pin: '1234' } }])
    })

    it('deleteHouseholdPin -> delete_household_pin: the typed name and the PIN, no household id', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).deleteHouseholdPin(AUTH, 'Rivera')
      expect(calls).toEqual([
        { op: 'rpc', name: 'delete_household_pin', args: { p_membership_id: 'membership-1', p_pin: '1234', p_confirm_name: 'Rivera' } },
      ])
    })

    it('a wrong PIN comes back as an auth error, as for every other settings RPC', async () => {
      const { client } = createFakeClient({
        rpc: { revoke_display_pin: { error: { message: 'incorrect PIN', code: '42501' }, status: 400 } },
      })
      await expect(createSupabaseSettingsApi(client).revokeDisplayPin(AUTH, 'display-1')).rejects.toMatchObject({
        code: 'auth',
        message: 'incorrect PIN',
      })
    })

    it('listHouseholdMembers and listHouseholdDisplays read on the device’s own client, like the adult ones', async () => {
      const { client, calls } = createFakeClient({
        from: { error: null, data: [{ id: 'm1', display_name: 'Sam', color: '#653437', role: 'owner', joined_at: '2026-01-02T10:00:00Z' }] },
      })
      const api = createSupabaseSettingsApi(client)
      expect(await api.listHouseholdMembers('household-1')).toEqual([
        { membershipId: 'm1', displayName: 'Sam', color: '#653437', role: 'owner', joinedAt: '2026-01-02T10:00:00Z' },
      ])
      await api.listHouseholdDisplays('household-1')
      expect(calls).toEqual([
        {
          op: 'from', table: 'memberships',
          chain: [
            ['select', 'id, display_name, color, role, joined_at'], ['eq', 'household_id', 'household-1'], ['is', 'left_at', null],
            ['order', 'joined_at', { ascending: true }],
          ],
        },
        {
          op: 'from', table: 'displays',
          chain: [
            ['select', 'id, name, last_seen_at, auth_user_id'], ['eq', 'household_id', 'household-1'], ['is', 'revoked_at', null],
            ['order', 'created_at', { ascending: true }],
          ],
        },
      ])
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

    it('revokeDisplay -> revoke_display', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).revokeDisplay(client, 'display-1')
      expect(calls).toEqual([{ op: 'rpc', name: 'revoke_display', args: { p_display_id: 'display-1' } }])
    })

    it('recordConsent -> record_consent with health-data consent', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).recordConsent(client, '2026-09-14')
      expect(calls).toEqual([{ op: 'rpc', name: 'record_consent', args: { p_policy_version: '2026-09-14', p_health_data_consent: true } }])
    })

    it("listMembers reads the household's current members, oldest first", async () => {
      const { client, calls } = createFakeClient({
        from: {
          error: null,
          data: [{ id: 'm1', display_name: 'Sam', color: '#653437', role: 'owner', joined_at: '2026-01-02T10:00:00Z' }],
        },
      })
      const rows = await createSupabaseSettingsApi(client).listMembers(client, 'household-1')
      expect(rows).toEqual([{ membershipId: 'm1', displayName: 'Sam', color: '#653437', role: 'owner', joinedAt: '2026-01-02T10:00:00Z' }])
      expect(calls).toEqual([{
        op: 'from', table: 'memberships',
        chain: [
          ['select', 'id, display_name, color, role, joined_at'], ['eq', 'household_id', 'household-1'], ['is', 'left_at', null],
          ['order', 'joined_at', { ascending: true }],
        ],
      }])
    })

    it("listDisplays reads the household's active displays, oldest first", async () => {
      const { client, calls } = createFakeClient({
        from: { error: null, data: [{ id: 'd1', name: 'Kitchen', last_seen_at: null, auth_user_id: 'device-1' }, { id: 'd2', name: 'Hall', last_seen_at: null, auth_user_id: null }] },
      })
      const rows = await createSupabaseSettingsApi(client).listDisplays(client, 'household-1')
      // `connected` says whether a tablet holds the display; the device user's id itself goes no further.
      expect(rows).toEqual([
        { displayId: 'd1', name: 'Kitchen', lastSeenAt: null, connected: true },
        { displayId: 'd2', name: 'Hall', lastSeenAt: null, connected: false },
      ])
      expect(calls).toEqual([{
        op: 'from', table: 'displays',
        chain: [
          ['select', 'id, name, last_seen_at, auth_user_id'], ['eq', 'household_id', 'household-1'], ['is', 'revoked_at', null],
          ['order', 'created_at', { ascending: true }],
        ],
      }])
    })
  })

  describe('photos', () => {
    const household = 'aaaaaaaa-0000-0000-0000-000000000001'

    function storageClient(result: unknown) {
      const upload = vi.fn(async () => result)
      const fromBucket = vi.fn(() => ({ upload }))
      const { client, calls } = createFakeClient()
      ;(client as unknown as { storage: unknown }).storage = { from: fromBucket }
      return { client, calls, upload, fromBucket }
    }

    it('uploadPhoto uploads the photo and then its thumbnail under a new id, without overwriting, private for 5 minutes in caches', async () => {
      const { client, upload, fromBucket } = storageClient({ data: { path: 'x' }, error: null })
      const image = new Blob(['jpeg'], { type: 'image/jpeg' })
      const thumbnail = new Blob(['thumb'], { type: 'image/jpeg' })
      const id = await createSupabaseSettingsApi(client).uploadPhoto(household, { image, thumbnail })
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(fromBucket).toHaveBeenCalledWith('household-photos')
      // A raw body, not a Blob: storage-js sends a Blob as a form with `cacheControl`, which Storage stores as
      // `max-age=<value>`; the header on a raw body is stored as given.
      const options = { contentType: 'image/jpeg', upsert: false, headers: { 'cache-control': 'private, max-age=300' } }
      expect(upload.mock.calls).toEqual([
        [`${household}/${id}.jpg`, expect.any(ArrayBuffer), options],
        [`${household}/${id}.thumb.jpg`, expect.any(ArrayBuffer), options],
      ])
      const calls = upload.mock.calls as unknown as [string, ArrayBuffer][]
      expect(new TextDecoder().decode(calls[0]![1])).toBe('jpeg')
      expect(new TextDecoder().decode(calls[1]![1])).toBe('thumb')
    })

    it('uploadPhoto fails without uploading the thumbnail when the photo upload fails', async () => {
      const { client, upload } = storageClient({ data: null, error: { message: 'new row violates row-level security policy', status: 403, statusCode: '403' } })
      const err = await createSupabaseSettingsApi(client).uploadPhoto(household, { image: new Blob(['a']), thumbnail: new Blob(['b']) }).catch((e: unknown) => e)
      // Storage refuses an upload only past the hourly quota of unrecorded files (or for a removed display): no PIN is
      // involved, so it is worded as its own message, not as a PIN failure.
      expect(err).toMatchObject({ code: 'invalid', message: 'this tablet can’t upload more photos right now; try again in an hour' })
      expect(upload).toHaveBeenCalledTimes(1)
    })

    it('uploadPhoto maps storage failures', async () => {
      const cases: Array<[unknown, string]> = [
        [{ message: 'new row violates row-level security policy', status: 403, statusCode: '403' }, 'invalid'],
        [{ message: 'The object exceeded the maximum allowed size', status: 413, statusCode: '413' }, 'invalid'],
        [{ message: 'Failed to fetch', status: undefined }, 'network'],
        [{ message: 'gateway', status: 502, statusCode: '502' }, 'network'],
        [{ message: 'odd', status: 409, statusCode: '409' }, 'other'],
      ]
      for (const [error, code] of cases) {
        const { client } = storageClient({ data: null, error })
        const err = await createSupabaseSettingsApi(client).uploadPhoto(household, { image: new Blob(), thumbnail: new Blob() }).catch((e: unknown) => e)
        expect(err, JSON.stringify(error)).toBeInstanceOf(SettingsError)
        expect((err as SettingsError).code, JSON.stringify(error)).toBe(code)
      }
    })

    it('uploadPhoto maps a thrown request to network', async () => {
      const { client, upload } = storageClient(null)
      upload.mockRejectedValueOnce(new TypeError('fetch failed'))
      const err = await createSupabaseSettingsApi(client).uploadPhoto(household, { image: new Blob(), thumbnail: new Blob() }).catch((e: unknown) => e)
      expect((err as SettingsError).code).toBe('network')
    })

    it('addPhoto -> add_photo with the kind', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).addPhoto(auth, 'photo-1', 'slideshow')
      expect(calls).toEqual([
        { op: 'rpc', name: 'add_photo', args: { p_membership_id: membershipId, p_pin: '1234', p_photo_id: 'photo-1', p_kind: 'slideshow' } },
      ])
    })

    it('addPhoto surfaces the 200-photo limit as invalid', async () => {
      const { client } = createFakeClient({
        rpc: { add_photo: { error: { message: 'a household can have at most 200 slideshow photos', code: '22023' }, status: 400 } },
      })
      const err = await createSupabaseSettingsApi(client).addPhoto(auth, 'photo-1', 'slideshow').catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'invalid', message: 'a household can have at most 200 slideshow photos' })
    })

    it('deletePhoto -> delete_photo', async () => {
      const { client, calls } = createFakeClient()
      await createSupabaseSettingsApi(client).deletePhoto(auth, 'photo-1')
      expect(calls).toEqual([
        { op: 'rpc', name: 'delete_photo', args: { p_membership_id: membershipId, p_pin: '1234', p_photo_id: 'photo-1' } },
      ])
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

    it('keeps the HTTP status on the error, so a browser sign-in can tell an expired token from the network', async () => {
      const { client } = createFakeClient({ rpc: { set_my_color: { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 } } })
      const err = await createSupabaseSettingsApi(client).setMyColor(auth, '#653437').catch((e) => e)
      expect((err as SettingsError).status).toBe(401)
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
