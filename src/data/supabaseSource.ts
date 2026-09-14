import { householdDate } from '@/domain/time'
import type { HouseholdSource } from './householdSource'
import type { HouseholdSnapshot } from './snapshot'
import type { RoostClient } from './supabase'
import type { Tables } from './database.types'
import {
  toChild, toDiaper, toDose, toFeeding, toGrocery, toHousehold, toJot, toMedicine, toMember,
  toRoutine, toRoutineOverride, toRoutineProgress, toSitterSession, toSleep, toSticker,
  toStickerCategory,
} from './mappers'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DEBOUNCE_MS = 300
/** How far around the oldest unresolved conflict dose to pull context doses for checkDose(). */
const CONFLICT_CONTEXT_WINDOW_MS = 72 * HOUR_MS

/** Household-scoped tables whose changes should trigger a snapshot reload. */
const HOUSEHOLD_FILTERED_TABLES = [
  'memberships', 'medicines', 'dose_entries', 'sleep_entries', 'feeding_entries',
  'diaper_entries', 'sticker_categories', 'sticker_entries', 'routines', 'routine_progress',
  'routine_day_overrides', 'jots', 'grocery_items', 'sitter_sessions',
] as const

/** Tables that lack a `household_id` column; RLS scopes them instead. */
const UNFILTERED_TABLES = ['children', 'child_households', 'feature_overrides'] as const

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned')
  return result.data
}

/**
 * Dose rows for a household: the last 48h, plus any unacknowledged, non-voided
 * `logged_offline` dose regardless of age (conflict doses must never age out of the
 * snapshot), plus every dose within ±72h of the oldest such conflict dose so
 * `checkDose()` has the context it needs to judge it. Merged by id.
 */
async function loadDoseRows(
  client: RoostClient,
  householdId: string,
  cutoff48h: string,
): Promise<Tables<'dose_entries'>[]> {
  const recent = unwrap<Tables<'dose_entries'>[]>(
    await client.from('dose_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h),
  )
  const unresolvedConflicts = unwrap<Tables<'dose_entries'>[]>(
    await client
      .from('dose_entries')
      .select('*')
      .eq('household_id', householdId)
      .eq('logged_offline', true)
      .is('voided_at', null)
      .is('conflict_acknowledged_at', null),
  )

  const byId = new Map<string, Tables<'dose_entries'>>()
  for (const d of recent) byId.set(d.id, d)
  for (const d of unresolvedConflicts) byId.set(d.id, d)

  if (unresolvedConflicts.length > 0) {
    const oldestAt = unresolvedConflicts.reduce(
      (oldest, d) => (Date.parse(d.at) < Date.parse(oldest) ? d.at : oldest),
      unresolvedConflicts[0]!.at,
    )
    const oldestMs = Date.parse(oldestAt)
    const windowStart = new Date(oldestMs - CONFLICT_CONTEXT_WINDOW_MS).toISOString()
    const windowEnd = new Date(oldestMs + CONFLICT_CONTEXT_WINDOW_MS).toISOString()
    const windowRows = unwrap<Tables<'dose_entries'>[]>(
      await client.from('dose_entries').select('*').eq('household_id', householdId).gte('at', windowStart).lte('at', windowEnd),
    )
    for (const d of windowRows) byId.set(d.id, d)
  }

  return [...byId.values()]
}

/**
 * Non-archived medicines, plus any archived medicine referenced by `doseRows` (a dose
 * for an archived medicine must still be able to show its name and check its limits).
 */
async function loadMedicineRows(
  client: RoostClient,
  householdId: string,
  activeMedicines: Tables<'medicines'>[],
  doseRows: Tables<'dose_entries'>[],
): Promise<Tables<'medicines'>[]> {
  const knownIds = new Set(activeMedicines.map((m) => m.id))
  const missingIds = [...new Set(doseRows.map((d) => d.medicine_id).filter((id) => !knownIds.has(id)))]
  if (missingIds.length === 0) return activeMedicines

  const archived = unwrap<Tables<'medicines'>[]>(await client.from('medicines').select('*').in('id', missingIds))
  return [...activeMedicines, ...archived]
}

export function createSupabaseSource(client: RoostClient): HouseholdSource {
  async function load(householdId: string, now: Date): Promise<HouseholdSnapshot> {
    const householdRow = unwrap<Tables<'households'>>(
      await client.from('households').select('*').eq('id', householdId).single(),
    )
    const household = toHousehold(householdRow)
    const today = householdDate(now, household.timeZone)
    const cutoff48h = new Date(now.getTime() - 2 * DAY_MS).toISOString()
    const cutoff8d = new Date(now.getTime() - 8 * DAY_MS).toISOString()
    const cutoff24h = new Date(now.getTime() - DAY_MS).toISOString()

    const [
      membershipResult, childResult, overrideResult, medicineResult, doseRows, sleepResult,
      feedingResult, diaperResult, stickerCategoryResult, stickerResult, routineResult,
      routineProgressResult, routineOverrideResult, jotResult, groceryResult, sitterSessionResult,
    ] = await Promise.all([
      client.from('memberships').select('id, display_name, color, role').eq('household_id', householdId).is('left_at', null),
      client.from('children').select('*').order('sort_order'),
      client.from('feature_overrides').select('*'),
      client.from('medicines').select('*').eq('household_id', householdId).is('archived_at', null),
      loadDoseRows(client, householdId, cutoff48h),
      client.from('sleep_entries').select('*').eq('household_id', householdId).or(`start_at.gte.${cutoff48h},end_at.is.null`),
      client.from('feeding_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h),
      client.from('diaper_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h),
      client.from('sticker_categories').select('*').eq('household_id', householdId).is('archived_at', null).order('sort_order'),
      client.from('sticker_entries').select('*').eq('household_id', householdId).gte('at', cutoff8d),
      client.from('routines').select('*').eq('household_id', householdId).order('sort_order'),
      client.from('routine_progress').select('*').eq('household_id', householdId).eq('day', today),
      client.from('routine_day_overrides').select('*').eq('household_id', householdId).eq('day', today),
      client.from('jots').select('*').eq('household_id', householdId).is('done_at', null),
      client.from('grocery_items').select('*').eq('household_id', householdId).or(`checked_at.is.null,checked_at.gte.${cutoff24h}`),
      client.from('sitter_sessions').select('*').eq('household_id', householdId).is('ended_at', null).maybeSingle(),
    ])

    const overridesByChild = new Map<string, { feature: string; enabled: boolean }[]>()
    for (const o of unwrap(overrideResult)) {
      const list = overridesByChild.get(o.child_id) ?? []
      list.push({ feature: o.feature, enabled: o.enabled })
      overridesByChild.set(o.child_id, list)
    }

    if (sitterSessionResult.error) throw new Error(sitterSessionResult.error.message)

    const medicineRows = await loadMedicineRows(client, householdId, unwrap(medicineResult), doseRows)

    return {
      household,
      members: unwrap(membershipResult).map(toMember),
      children: unwrap(childResult).map((row) => toChild(row, overridesByChild.get(row.id) ?? [])),
      medicines: medicineRows.map(toMedicine),
      doses: doseRows.map(toDose),
      sleeps: unwrap(sleepResult).map(toSleep),
      feedings: unwrap(feedingResult).map(toFeeding),
      diapers: unwrap(diaperResult).map(toDiaper),
      stickerCategories: unwrap(stickerCategoryResult).map(toStickerCategory),
      stickers: unwrap(stickerResult).map(toSticker),
      routines: unwrap(routineResult).map(toRoutine),
      routineProgress: unwrap(routineProgressResult).map(toRoutineProgress),
      routineOverrides: unwrap(routineOverrideResult).map(toRoutineOverride),
      jots: unwrap(jotResult).map(toJot),
      groceries: unwrap(groceryResult).map(toGrocery),
      activeSitterSession: sitterSessionResult.data ? toSitterSession(sitterSessionResult.data) : null,
      loadedAt: now.toISOString(),
    }
  }

  function subscribe(
    householdId: string,
    onChange: () => void,
    onStatus?: (status: 'connected' | 'disconnected') => void,
  ): () => void {
    const channel = client.channel(`household:${householdId}`)
    let timer: ReturnType<typeof setTimeout> | undefined
    let hasConnectedBefore = false

    const scheduleChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        onChange()
      }, DEBOUNCE_MS)
    }

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, scheduleChange)
    for (const table of HOUSEHOLD_FILTERED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, scheduleChange)
    }
    for (const table of UNFILTERED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleChange)
    }
    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        onStatus?.('connected')
        // Reconnecting (not the initial connect) may have missed events; reload to catch up.
        if (hasConnectedBefore) onChange()
        hasConnectedBefore = true
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onStatus?.('disconnected')
      }
    })

    return () => {
      if (timer) clearTimeout(timer)
      client.removeChannel(channel)
    }
  }

  return { load, subscribe }
}
