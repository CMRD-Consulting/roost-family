/**
 * Meals tab (kitchen spec §5.4): the seven day cards of the household week — today first, then the next six —
 * each with the weekday, the date and what is planned. Pure — no Vue, no stores.
 */
import type { MealPlanEntry, Recipe } from '@/data/snapshot'
import type { HouseholdDate } from '@/domain/types'
import { addDays } from './todoModel'

/** Today plus the next six days (kitchen spec §5.4). */
export const MEAL_DAYS = 7
/** Matches the `meal_plan_entries.text` check constraint (kitchen spec §6). */
export const MAX_MEAL_TEXT = 80

export const NOT_PLANNED = 'Not planned'

/** What a day holds: the label shown and, when it was planned from the recipe box, the recipe. */
export interface PlannedMeal {
  text: string
  recipeId: string | null
}

export interface MealDayCard {
  day: HouseholdDate
  /** "Monday", or "Today" — the card also carries `isToday`, so today is never marked by colour alone. */
  weekdayLabel: string
  /** "Sep 21". */
  dateLabel: string
  planned: PlannedMeal | null
  isToday: boolean
}

const weekdayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** A household date is formatted in UTC, never in the tablet's own zone, so the label can't shift a day. */
function atUtc(day: HouseholdDate): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function weekdayLabel(day: HouseholdDate): string {
  return weekdayFormat.format(atUtc(day))
}

export function dateLabel(day: HouseholdDate): string {
  return dateFormat.format(atUtc(day))
}

/** Today first, then the next six days. */
export function mealDays(today: HouseholdDate): HouseholdDate[] {
  return Array.from({ length: MEAL_DAYS }, (_unused, i) => addDays(today, i))
}

/**
 * What one day holds, or null when nothing is planned. The entry's own `text` is the label it shows (kitchen
 * spec §5.1) — that is what keeps a plan readable once its recipe is archived — so this is also exactly the
 * `previous` a `meal.set` or `meal.clear` carries. The recipe box is only a fallback, for a row somehow
 * written without a label.
 */
export function plannedFor(
  mealPlan: MealPlanEntry[] | undefined,
  recipes: Recipe[] | undefined,
  day: HouseholdDate,
): PlannedMeal | null {
  const entry = (mealPlan ?? []).find((e) => e.day === day)
  if (!entry) return null
  const fallback = (recipes ?? []).find((r) => r.id === entry.recipeId)?.title ?? ''
  const text = entry.text.trim().length > 0 ? entry.text : fallback
  return text.length === 0 ? null : { text, recipeId: entry.recipeId }
}

/** The seven cards the Meals tab shows. */
export function buildMealsModel(
  mealPlan: MealPlanEntry[] | undefined,
  recipes: Recipe[] | undefined,
  today: HouseholdDate,
): MealDayCard[] {
  return mealDays(today).map((day) => ({
    day,
    weekdayLabel: day === today ? 'Today' : weekdayLabel(day),
    dateLabel: dateLabel(day),
    planned: plannedFor(mealPlan, recipes, day),
    isToday: day === today,
  }))
}

/** A typed-in dinner as it is saved: trimmed and capped. Empty means "don't save". */
export function cleanMealText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_MEAL_TEXT)
}
