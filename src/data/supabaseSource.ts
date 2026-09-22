import { TZDate } from '@date-fns/tz'
import { householdDate } from '@/domain/time'
import type { HouseholdSource } from './householdSource'
import type { HouseholdSnapshot, Recipe, RecipeLine } from './snapshot'
import type { RoostClient } from './supabase'
import type { Tables } from './database.types'
import {
  toChild, toDiaper, toDose, toFeeding, toGrocery, toHousehold, toJot, toMealPlanEntry, toMedicine, toMember,
  toRecipe, toRecipeLine, toRoutine, toRoutineOverride, toRoutineProgress, toShoppingList, toSitterSession,
  toSleep, toSticker, toPhoto, toStickerCategory, toTask, toWeather,
} from './mappers'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DEBOUNCE_MS = 300
/** How long after a sitter session ends its summary is still offered on the other displays. */
const RECENT_SITTER_SESSION_MS = 12 * HOUR_MS
/** At most this many unseen sitter summaries are offered. */
const UNSEEN_SITTER_SESSIONS_MAX = 3
/** How far around the oldest unresolved conflict dose to pull context doses for checkDose(). */
const CONFLICT_CONTEXT_WINDOW_MS = 72 * HOUR_MS
/** How many days either side of today the meal plan is loaded for (spec §7.3). */
const MEAL_PLAN_WINDOW_DAYS = 7

/** Household-scoped tables whose changes should trigger a snapshot reload. */
const HOUSEHOLD_FILTERED_TABLES = [
  'memberships', 'medicines', 'dose_entries', 'sleep_entries', 'feeding_entries',
  'diaper_entries', 'sticker_categories', 'sticker_entries', 'routines', 'routine_progress',
  'routine_day_overrides', 'jots', 'grocery_items', 'sitter_sessions', 'household_weather', 'photos',
  'shopping_lists', 'tasks', 'recipes', 'recipe_ingredients', 'recipe_steps', 'meal_plan_entries',
] as const

/** Tables that lack a `household_id` column; RLS scopes them instead. */
const UNFILTERED_TABLES = ['children', 'child_households', 'feature_overrides'] as const

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('No data returned')
  return result.data
}

/** The household's own calendar date `days` away from `now`. */
function householdDayOffset(now: Date, timeZone: string, days: number): string {
  const shifted = new TZDate(now.getTime(), timeZone)
  shifted.setDate(shifted.getDate() + days)
  return householdDate(new Date(shifted.getTime()), timeZone)
}

type Rows<T> = { data: T[] | null; error: { message: string } | null }

/** Recipe lines grouped by their recipe, keeping the order they were queried in (by `sort`). */
function linesByRecipe(rows: Tables<'recipe_ingredients'>[] | Tables<'recipe_steps'>[]): Map<string, RecipeLine[]> {
  const byRecipe = new Map<string, RecipeLine[]>()
  for (const row of rows) {
    const lines = byRecipe.get(row.recipe_id) ?? []
    lines.push(toRecipeLine(row))
    byRecipe.set(row.recipe_id, lines)
  }
  return byRecipe
}

/**
 * Recipes with their ingredients and steps. The three tables are queried separately (the lines filtered by
 * household, not by recipe) and joined here. Recipes are never essential: a failed read hides the recipe box
 * rather than failing the whole load, exactly as weather and photos do.
 */
function toRecipes(
  recipeResult: Rows<Tables<'recipes'>>,
  ingredientResult: Rows<Tables<'recipe_ingredients'>>,
  stepResult: Rows<Tables<'recipe_steps'>>,
): Recipe[] {
  if (recipeResult.error || ingredientResult.error || stepResult.error || !recipeResult.data) return []
  const ingredients = linesByRecipe(ingredientResult.data ?? [])
  const steps = linesByRecipe(stepResult.data ?? [])
  return recipeResult.data.map((row) => toRecipe(row, ingredients.get(row.id) ?? [], steps.get(row.id) ?? []))
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
    await client.from('dose_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h).order('at', { ascending: true }),
  )
  const unresolvedConflicts = unwrap<Tables<'dose_entries'>[]>(
    await client
      .from('dose_entries')
      .select('*')
      .eq('household_id', householdId)
      .eq('logged_offline', true)
      .is('voided_at', null)
      .is('conflict_acknowledged_at', null)
      .order('at', { ascending: true }),
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
      await client
        .from('dose_entries')
        .select('*')
        .eq('household_id', householdId)
        .gte('at', windowStart)
        .lte('at', windowEnd)
        .order('at', { ascending: true }),
    )
    for (const d of windowRows) byId.set(d.id, d)
  }

  return [...byId.values()]
}

/**
 * Children who belong to this household (via `child_households`), plus their feature
 * overrides, grouped by child id. `feature_overrides` has no household_id of its own,
 * so it's filtered to just the ids of the children we actually loaded — and skipped
 * entirely when there are none.
 */
async function loadChildrenAndOverrides(
  client: RoostClient,
  householdId: string,
): Promise<{
  childRows: Tables<'children'>[]
  overridesByChild: Map<string, { feature: string; enabled: boolean }[]>
}> {
  const childRows = unwrap<Tables<'children'>[]>(
    await client
      .from('children')
      .select('*, child_households!inner(household_id)')
      .eq('child_households.household_id', householdId)
      .order('sort_order'),
  )

  const overridesByChild = new Map<string, { feature: string; enabled: boolean }[]>()
  const childIds = childRows.map((c) => c.id)
  if (childIds.length > 0) {
    const overrideRows = unwrap<{ child_id: string; feature: string; enabled: boolean }[]>(
      await client.from('feature_overrides').select('*').in('child_id', childIds),
    )
    for (const o of overrideRows) {
      const list = overridesByChild.get(o.child_id) ?? []
      list.push({ feature: o.feature, enabled: o.enabled })
      overridesByChild.set(o.child_id, list)
    }
  }

  return { childRows, overridesByChild }
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
    // Also load tomorrow's routine progress/overrides so they're ready the instant the
    // household's day rolls over, without waiting on a fresh load past midnight.
    const tomorrow = householdDayOffset(now, household.timeZone, 1)
    const mealPlanFrom = householdDayOffset(now, household.timeZone, -MEAL_PLAN_WINDOW_DAYS)
    const mealPlanTo = householdDayOffset(now, household.timeZone, MEAL_PLAN_WINDOW_DAYS)
    const cutoff48h = new Date(now.getTime() - 2 * DAY_MS).toISOString()
    const cutoff8d = new Date(now.getTime() - 8 * DAY_MS).toISOString()
    const cutoff24h = new Date(now.getTime() - DAY_MS).toISOString()
    const cutoff12h = new Date(now.getTime() - RECENT_SITTER_SESSION_MS).toISOString()

    const [
      membershipResult, childrenAndOverrides, medicineResult, doseRows, sleepResult,
      feedingResult, diaperResult, stickerCategoryResult, stickerResult, routineResult,
      routineProgressResult, routineOverrideResult, jotResult, groceryResult, sitterSessionResult,
      recentSitterSessionResult, unseenSitterSessionResult, weatherResult, photoResult,
      shoppingListResult, taskResult, recipeResult, ingredientResult, stepResult, mealPlanResult,
    ] = await Promise.all([
      client.from('memberships').select('id, display_name, color, role').eq('household_id', householdId).is('left_at', null),
      loadChildrenAndOverrides(client, householdId),
      client.from('medicines').select('*').eq('household_id', householdId).is('archived_at', null),
      loadDoseRows(client, householdId, cutoff48h),
      client
        .from('sleep_entries')
        .select('*')
        .eq('household_id', householdId)
        .or(`start_at.gte.${cutoff48h},end_at.is.null`)
        .order('start_at', { ascending: true }),
      client.from('feeding_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h).order('at', { ascending: true }),
      client.from('diaper_entries').select('*').eq('household_id', householdId).gte('at', cutoff48h).order('at', { ascending: true }),
      client.from('sticker_categories').select('*').eq('household_id', householdId).is('archived_at', null).order('sort_order'),
      client.from('sticker_entries').select('*').eq('household_id', householdId).gte('at', cutoff8d).order('at', { ascending: true }),
      client.from('routines').select('*').eq('household_id', householdId).order('sort_order'),
      client.from('routine_progress').select('*').eq('household_id', householdId).in('day', [today, tomorrow]),
      client.from('routine_day_overrides').select('*').eq('household_id', householdId).in('day', [today, tomorrow]),
      client.from('jots').select('*').eq('household_id', householdId).is('done_at', null),
      client.from('grocery_items').select('*').eq('household_id', householdId).or(`checked_at.is.null,checked_at.gte.${cutoff24h}`),
      client
        .from('sitter_sessions')
        .select('*')
        .eq('household_id', householdId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('sitter_sessions')
        .select('*')
        .eq('household_id', householdId)
        .gte('ended_at', cutoff12h)
        .order('ended_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('sitter_sessions')
        .select('*')
        .eq('household_id', householdId)
        .gte('ended_at', cutoff12h)
        .is('summary_shown_at', null)
        .order('ended_at', { ascending: false })
        .limit(UNSEEN_SITTER_SESSIONS_MAX),
      client
        .from('household_weather')
        .select('fetched_at, current_temp_f, high_f, low_f, precip_chance, summary, icon')
        .eq('household_id', householdId)
        .maybeSingle(),
      client.from('photos').select('id, storage_path, kind, added_at').eq('household_id', householdId).order('added_at', { ascending: true }),
      client.from('shopping_lists').select('*').eq('household_id', householdId).is('archived_at', null).order('created_at', { ascending: true }),
      client.from('tasks').select('*').eq('household_id', householdId).or(`done_at.is.null,done_at.gte.${cutoff24h}`),
      client.from('recipes').select('*').eq('household_id', householdId).is('archived_at', null).order('created_at', { ascending: false }),
      client.from('recipe_ingredients').select('*').eq('household_id', householdId).order('sort', { ascending: true }),
      client.from('recipe_steps').select('*').eq('household_id', householdId).order('sort', { ascending: true }),
      client.from('meal_plan_entries').select('*').eq('household_id', householdId).gte('day', mealPlanFrom).lte('day', mealPlanTo),
    ])

    if (sitterSessionResult.error) throw new Error(sitterSessionResult.error.message)
    if (recentSitterSessionResult.error) throw new Error(recentSitterSessionResult.error.message)
    // The newest few unseen, shown oldest first.
    const unseenSitterSessions = unwrap(unseenSitterSessionResult).map(toSitterSession).reverse()

    const medicineRows = await loadMedicineRows(client, householdId, unwrap(medicineResult), doseRows)
    const { childRows, overridesByChild } = childrenAndOverrides

    return {
      household,
      members: unwrap(membershipResult).map(toMember),
      children: childRows.map((row) => toChild(row, overridesByChild.get(row.id) ?? [])),
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
      recentSitterSession:
        unseenSitterSessions[0] ?? (recentSitterSessionResult.data ? toSitterSession(recentSitterSessionResult.data) : null),
      unseenSitterSessions,
      // Weather is never essential (spec §13): a failed read hides it rather than failing the load.
      weather: weatherResult.error ? null : toWeather(weatherResult.data),
      // Photos are never essential either: without them Night Mode shows the clock alone (spec §7.7).
      photos: photoResult.error || !photoResult.data ? [] : photoResult.data.map(toPhoto),
      shoppingLists: unwrap(shoppingListResult).map(toShoppingList),
      tasks: unwrap(taskResult).map(toTask),
      recipes: toRecipes(recipeResult, ingredientResult, stepResult),
      mealPlan: unwrap(mealPlanResult).map(toMealPlanEntry),
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
