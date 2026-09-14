import type { Feature } from '@/domain/types'
import type { EntryTable } from './logCommands'
import {
  SettingsError,
  type AddChildInput,
  type AdultClient,
  type AdultMembershipRow,
  type DisplayRow,
  type EntryPatch,
  type HouseholdSettingsInput,
  type ListEntriesQuery,
  type LogEntryRow,
  type MemberRow,
  type MedicineInput,
  type RoutineInput,
  type SettingsApi,
  type SettingsAuth,
  type SettingsErrorCode,
  type StickerCategoryInput,
  type UpdateChildInput,
} from './settingsApi'
import { PHOTO_BUCKET, photoPath } from './photosApi'
import type { PhotoKind, SitterInfo } from './snapshot'
import type { RoostClient } from './supabase'

type OpResult = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

/** The row's own time column for each table `listEntries`/`deleteOldEntries` can read. */
const TIME_COLUMN: Record<string, string> = {
  sleep_entries: 'start_at',
  feeding_entries: 'at',
  sticker_entries: 'at',
  diaper_entries: 'at',
  dose_entries: 'at',
  jots: 'created_at',
}

/** Settings > Logs edit fields -> table columns. */
const PATCH_COLUMNS: Record<keyof EntryPatch, string> = {
  at: 'at',
  startAt: 'start_at',
  endAt: 'end_at',
  type: 'type',
  amount: 'amount',
  note: 'note',
  categoryId: 'category_id',
  kind: 'kind',
  text: 'text',
  doneAt: 'done_at',
}

const ENTRY_GONE = 'That entry no longer exists.'
const END_BEFORE_START = 'The end time can’t be before the start.'

/** update_entry/delete_entry failures in the adult's words: a missing entry, or a sleep ending before it starts
 *  (the server says so itself; a bare check violation, 23514, means the same on these tables). */
function runEntryRpc(op: () => PromiseLike<OpResult>): Promise<void> {
  return run(async () => {
    const result = await op()
    const error = result.error
    if (!error) return result
    if (error.code === '23514' || /end time can.t be before the start/i.test(error.message)) {
      return { ...result, error: { message: END_BEFORE_START, code: '22023' } }
    }
    if (error.code === '22023' && /entry not found/i.test(error.message)) {
      return { ...result, error: { message: ENTRY_GONE, code: '22023' } }
    }
    return result
  })
}

/**
 * Coarse classification of a Postgrest/RPC failure, mirroring the server's SQLSTATE convention
 * (42501 = auth, 22023 = invalid) plus the usual "this is a network problem" signals.
 */
function classify(status: number | null, code: string | null): SettingsErrorCode {
  if (code === '42501') return 'auth'
  if (code === '22023') return 'invalid'
  if (code === '23514') return 'invalid'
  if (status === null && code === null) return 'network'
  if (status === 401 || status === 408 || status === 429 || (status !== null && status >= 500)) return 'network'
  if (code?.startsWith('PGRST3')) return 'network'
  return 'other'
}

/** Runs a Postgrest/RPC call and maps failures to SettingsError. Returns the response data. */
async function run<T>(op: () => PromiseLike<OpResult>): Promise<T> {
  let result: OpResult
  try {
    result = await op()
  } catch (e) {
    throw new SettingsError(e instanceof Error ? e.message : String(e), 'network')
  }
  if (result.error) {
    const code = result.error.code || null
    const status = result.status || null
    throw new SettingsError(result.error.message, classify(status, code), status)
  }
  return result.data as T
}

/** A Storage upload failure: no status means the request never got a response. RLS refusals (401/403) mean this
 *  device is no longer a member; 413 means the file is too large for the bucket. */
function storageError(error: { message: string; status?: number; statusCode?: string }): SettingsError {
  const status = error.status ?? (error.statusCode ? Number(error.statusCode) : undefined)
  let code: SettingsErrorCode = 'other'
  if (status === undefined || Number.isNaN(status)) code = 'network'
  else if (status === 401 || status === 403) code = 'auth'
  else if (status === 413 || error.statusCode === '413') code = 'invalid'
  else if (status === 408 || status === 429 || status >= 500) code = 'network'
  return new SettingsError(error.message, code)
}

/** Builds a `SettingsApi` whose PIN-checked methods run against `client` (the display's own client: PIN RPCs
 *  are security-definer and re-verify the PIN server-side, so no adult sign-in is needed to call them). The
 *  members/displays/deletion methods instead take an `AdultClient` per call, one per method's own signature. */
export function createSupabaseSettingsApi(client: RoostClient): SettingsApi {
  async function settingsVerify(auth: SettingsAuth) {
    const rows = await run<{ out_role: string; out_display_name: string }[]>(() =>
      client.rpc('settings_verify', { p_membership_id: auth.membershipId, p_pin: auth.pin }),
    )
    const row = rows[0]
    if (!row) throw new SettingsError('Settings verification did not return a membership', 'other')
    return { role: row.out_role, displayName: row.out_display_name }
  }

  async function updateHouseholdSettings(auth: SettingsAuth, input: HouseholdSettingsInput): Promise<void> {
    await run(() =>
      client.rpc('update_household_settings', {
        p_membership_id: auth.membershipId,
        p_pin: auth.pin,
        p_name: input.name,
        p_zip: input.zip,
        p_time_zone: input.timeZone,
        p_leave_by_buffer_min: input.leaveByBufferMin,
        p_default_night_start: input.defaultNightSleep.start,
        p_default_night_end: input.defaultNightSleep.end,
        p_night_mode_start: input.nightMode.start,
        p_night_mode_end: input.nightMode.end,
        p_diaper_log_enabled: input.diaperLogEnabled,
      } as never),
    )
  }

  async function setHouseholdLocation(auth: SettingsAuth, lat: number, lon: number): Promise<void> {
    await run(() => client.rpc('set_household_location', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_lat: lat, p_lon: lon }))
  }

  async function updateSitterInfo(auth: SettingsAuth, info: SitterInfo): Promise<void> {
    await run(() =>
      client.rpc('update_sitter_info', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_info: info as never }),
    )
  }

  async function addChild(auth: SettingsAuth, input: AddChildInput): Promise<string> {
    return run<string>(() =>
      client.rpc('add_child_pin', {
        p_membership_id: auth.membershipId, p_pin: auth.pin, p_name: input.name, p_birthday: input.birthday, p_color: input.color,
      }),
    )
  }

  async function updateChild(auth: SettingsAuth, input: UpdateChildInput): Promise<void> {
    await run(() =>
      client.rpc('update_child', {
        p_membership_id: auth.membershipId,
        p_pin: auth.pin,
        p_child_id: input.childId,
        p_name: input.name,
        p_birthday: input.birthday,
        p_color: input.color,
        p_allergies: input.allergies,
        p_food_rules: input.foodRules,
        p_night_start: input.nightSleep?.start ?? null,
        p_night_end: input.nightSleep?.end ?? null,
      } as never),
    )
  }

  async function setFeatureOverride(auth: SettingsAuth, childId: string, feature: Feature, enabled: boolean | null): Promise<void> {
    await run(() =>
      client.rpc('set_feature_override', {
        p_membership_id: auth.membershipId, p_pin: auth.pin, p_child_id: childId, p_feature: feature, p_enabled: enabled,
      } as never),
    )
  }

  async function upsertRoutine(auth: SettingsAuth, input: RoutineInput): Promise<string> {
    return run<string>(() =>
      client.rpc('upsert_routine', {
        p_membership_id: auth.membershipId,
        p_pin: auth.pin,
        p_routine_id: input.routineId,
        p_child_id: input.childId,
        p_name: input.name,
        p_weekdays: input.weekdays,
        p_steps: input.steps,
      } as never),
    )
  }

  async function deleteRoutine(auth: SettingsAuth, routineId: string): Promise<void> {
    await run(() => client.rpc('delete_routine', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_routine_id: routineId }))
  }

  async function setRoutineDayOverride(auth: SettingsAuth, childId: string, day: string, routineId: string | null): Promise<void> {
    await run(() =>
      client.rpc('set_routine_day_override', {
        p_membership_id: auth.membershipId, p_pin: auth.pin, p_child_id: childId, p_day: day, p_routine_id: routineId,
      } as never),
    )
  }

  async function upsertMedicine(auth: SettingsAuth, input: MedicineInput): Promise<string> {
    return run<string>(() =>
      client.rpc('upsert_medicine', {
        p_membership_id: auth.membershipId,
        p_pin: auth.pin,
        p_medicine_id: input.medicineId,
        p_child_id: input.childId,
        p_name: input.name,
        p_min_interval_hours: input.minIntervalHours,
        p_max_doses_per_24h: input.maxDosesPer24h,
      } as never),
    )
  }

  async function archiveMedicine(auth: SettingsAuth, medicineId: string): Promise<void> {
    await run(() => client.rpc('archive_medicine', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_medicine_id: medicineId }))
  }

  async function upsertStickerCategory(auth: SettingsAuth, input: StickerCategoryInput): Promise<string> {
    return run<string>(() =>
      client.rpc('upsert_sticker_category', {
        p_membership_id: auth.membershipId,
        p_pin: auth.pin,
        p_category_id: input.categoryId,
        p_name: input.name,
        p_icon_key: input.iconKey,
        p_sort_order: input.sortOrder,
      } as never),
    )
  }

  async function archiveStickerCategory(auth: SettingsAuth, categoryId: string): Promise<void> {
    await run(() =>
      client.rpc('archive_sticker_category', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_category_id: categoryId }),
    )
  }

  async function setMyColor(auth: SettingsAuth, color: string): Promise<void> {
    await run(() => client.rpc('set_my_color', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_color: color }))
  }

  async function deleteOldEntries(auth: SettingsAuth, table: EntryTable, before: string): Promise<number> {
    return run<number>(() =>
      client.rpc('delete_old_entries', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_table: table, p_before: before }),
    )
  }

  async function listEntries(query: ListEntriesQuery): Promise<LogEntryRow[]> {
    const timeColumn = TIME_COLUMN[query.table]!
    // The table (and so the row shape) varies per call, so this reads generically rather than through the
    // typed schema (which would need a distinct call site per table for no real benefit here).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let builder: any = client.from(query.table).select('*').order(timeColumn, { ascending: false }).limit(query.limit)
    if (query.childId) builder = builder.eq('child_id', query.childId)
    if (query.before) builder = builder.lt(timeColumn, query.before)

    const rows = await run<Record<string, unknown>[]>(() => builder)
    return (rows ?? []).map((row) => ({
      id: row.id as string,
      childId: row.child_id as string,
      at: row[timeColumn] as string,
      loggedByName: (row.logged_by_name as string | null | undefined) ?? null,
      row,
    }))
  }

  async function updateEntry(auth: SettingsAuth, table: EntryTable, entryId: string, patch: EntryPatch): Promise<void> {
    const fields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) fields[PATCH_COLUMNS[key as keyof EntryPatch]] = value
    }
    await runEntryRpc(() =>
      client.rpc('update_entry', {
        p_membership_id: auth.membershipId, p_pin: auth.pin, p_table: table, p_entry_id: entryId, p_fields: fields as never,
      }),
    )
  }

  async function deleteEntry(auth: SettingsAuth, table: EntryTable, entryId: string): Promise<void> {
    await runEntryRpc(() =>
      client.rpc('delete_entry', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_table: table, p_entry_id: entryId }),
    )
  }

  async function voidDose(auth: SettingsAuth, doseId: string, reason: string): Promise<void> {
    await run(() =>
      client.rpc('void_dose', { p_dose_id: doseId, p_membership_id: auth.membershipId, p_pin: auth.pin, p_reason: reason }),
    )
  }

  async function uploadPhoto(householdId: string, image: Blob): Promise<string> {
    const photoId = crypto.randomUUID()
    let result: { error: { message: string; status?: number; statusCode?: string } | null }
    try {
      result = await client.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath(householdId, photoId), image, { contentType: 'image/jpeg', upsert: false })
    } catch (e) {
      throw new SettingsError(e instanceof Error ? e.message : String(e), 'network')
    }
    if (result.error) throw storageError(result.error)
    return photoId
  }

  async function addPhoto(auth: SettingsAuth, photoId: string, kind: PhotoKind): Promise<void> {
    await run(() => client.rpc('add_photo', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_photo_id: photoId, p_kind: kind }))
  }

  async function deletePhoto(auth: SettingsAuth, photoId: string): Promise<void> {
    await run(() => client.rpc('delete_photo', { p_membership_id: auth.membershipId, p_pin: auth.pin, p_photo_id: photoId }))
  }

  // ─── Full sign-in only ────────────────────────────────────────────────────
  async function createMemberInvite(adult: AdultClient, householdId: string, role: 'owner' | 'adult') {
    const rows = await run<{ out_token: string; out_expires_at: string }[]>(() =>
      adult.rpc('create_member_invite', { p_household_id: householdId, p_role: role }),
    )
    const row = rows[0]
    if (!row) throw new SettingsError('Invite creation did not return a token', 'other')
    return { token: row.out_token, expiresAt: row.out_expires_at }
  }

  async function acceptMemberInvite(
    adult: AdultClient,
    input: { token: string; displayName: string; color: string; pin: string },
  ): Promise<string> {
    return run<string>(() =>
      adult.rpc('accept_member_invite', {
        p_token: input.token, p_display_name: input.displayName, p_color: input.color, p_pin: input.pin,
      }),
    )
  }

  async function revokeMemberInvite(token: string): Promise<void> {
    await run(() => client.rpc('revoke_member_invite', { p_invite_token: token }))
  }

  async function setMemberRole(adult: AdultClient, membershipId: string, role: 'owner' | 'adult'): Promise<void> {
    await run(() => adult.rpc('set_member_role', { p_membership_id: membershipId, p_role: role }))
  }

  async function removeMember(adult: AdultClient, membershipId: string): Promise<void> {
    await run(() => adult.rpc('remove_member', { p_membership_id: membershipId }))
  }

  async function leaveHousehold(adult: AdultClient, householdId: string): Promise<void> {
    await run(() => adult.rpc('leave_household', { p_household_id: householdId }))
  }

  async function setMyPin(adult: AdultClient, householdId: string, pin: string): Promise<void> {
    await run(() => adult.rpc('set_my_pin', { p_household_id: householdId, p_pin: pin }))
  }

  async function adultMembership(adult: AdultClient, householdId: string, userId: string) {
    const rows = await run<{ id: string; role: string }[] | null>(() =>
      adult.from('memberships').select('id, role').eq('household_id', householdId).eq('user_id', userId).is('left_at', null).limit(1),
    )
    const row = rows?.[0]
    return row ? { membershipId: row.id, role: row.role } : null
  }

  async function myMemberships(adult: AdultClient, userId: string): Promise<AdultMembershipRow[]> {
    type Row = {
      id: string
      household_id: string
      role: AdultMembershipRow['role']
      display_name: string
      color: string
      households: { name: string; time_zone: string } | { name: string; time_zone: string }[] | null
    }
    const rows = await run<Row[] | null>(() =>
      adult
        .from('memberships')
        .select('id, household_id, role, display_name, color, households(name, time_zone)')
        .eq('user_id', userId)
        .is('left_at', null)
        .order('joined_at', { ascending: true }),
    )
    return (rows ?? []).flatMap((r) => {
      // A deleted household is hidden from its members by RLS, so it embeds as null: leave it out.
      const household = Array.isArray(r.households) ? r.households[0] : r.households
      if (!household) return []
      return [{
        membershipId: r.id,
        householdId: r.household_id,
        householdName: household.name,
        timeZone: household.time_zone,
        role: r.role,
        displayName: r.display_name,
        color: r.color,
      }]
    })
  }

  async function renameDisplay(adult: AdultClient, displayId: string, name: string): Promise<void> {
    await run(() => adult.rpc('rename_display', { p_display_id: displayId, p_name: name }))
  }

  async function revokeDisplay(adult: AdultClient, displayId: string): Promise<void> {
    await run(() => adult.rpc('revoke_display', { p_display_id: displayId }))
  }

  async function recordConsent(adult: AdultClient, policyVersion: string): Promise<void> {
    await run(() => adult.rpc('record_consent', { p_policy_version: policyVersion, p_health_data_consent: true }))
  }

  async function listMembers(adult: AdultClient, householdId: string): Promise<MemberRow[]> {
    const rows = await run<{ id: string; display_name: string; color: string; role: MemberRow['role']; joined_at: string }[] | null>(() =>
      adult
        .from('memberships')
        .select('id, display_name, color, role, joined_at')
        .eq('household_id', householdId)
        .is('left_at', null)
        .order('joined_at', { ascending: true }),
    )
    return (rows ?? []).map((r) => ({ membershipId: r.id, displayName: r.display_name, color: r.color, role: r.role, joinedAt: r.joined_at }))
  }

  async function listDisplays(adult: AdultClient, householdId: string): Promise<DisplayRow[]> {
    const rows = await run<{ id: string; name: string; last_seen_at: string | null }[] | null>(() =>
      adult
        .from('displays')
        .select('id, name, last_seen_at')
        .eq('household_id', householdId)
        .is('revoked_at', null)
        .order('created_at', { ascending: true }),
    )
    return (rows ?? []).map((r) => ({ displayId: r.id, name: r.name, lastSeenAt: r.last_seen_at }))
  }

  async function deleteHousehold(adult: AdultClient, householdId: string, confirmName: string): Promise<void> {
    await run(() => adult.rpc('delete_household', { p_household_id: householdId, p_confirm_name: confirmName }))
  }

  return {
    settingsVerify,
    updateHouseholdSettings,
    setHouseholdLocation,
    updateSitterInfo,
    addChild,
    updateChild,
    setFeatureOverride,
    upsertRoutine,
    deleteRoutine,
    setRoutineDayOverride,
    upsertMedicine,
    archiveMedicine,
    upsertStickerCategory,
    archiveStickerCategory,
    setMyColor,
    deleteOldEntries,
    listEntries,
    updateEntry,
    deleteEntry,
    voidDose,
    uploadPhoto,
    addPhoto,
    deletePhoto,
    createMemberInvite,
    acceptMemberInvite,
    revokeMemberInvite,
    setMemberRole,
    removeMember,
    leaveHousehold,
    setMyPin,
    adultMembership,
    myMemberships,
    recordConsent,
    listMembers,
    listDisplays,
    renameDisplay,
    revokeDisplay,
    deleteHousehold,
  }
}
