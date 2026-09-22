/**
 * Kitchen screen (kitchen spec §2, §7.4): which of the four tabs is showing, and the count the main screen's
 * Kitchen button badges. Pure — no Vue, no stores.
 */
import type { Task } from '@/data/snapshot'
import type { HouseholdDate } from '@/domain/types'

export const KITCHEN_TABS = ['shopping', 'todo', 'meals', 'recipes'] as const

export type KitchenTab = (typeof KITCHEN_TABS)[number]

export const KITCHEN_TAB_LABELS: Record<KitchenTab, string> = {
  shopping: 'Shopping',
  todo: 'To-do',
  meals: 'Meals',
  recipes: 'Recipes',
}

/** Shopping is what a tablet in a kitchen is wanted for most; an unknown or missing `?tab=` lands there. */
export const DEFAULT_KITCHEN_TAB: KitchenTab = 'shopping'

/**
 * The tab a `?tab=` query value asks for (kitchen spec §7.4), defaulting to Shopping. Takes the raw query
 * value, which vue-router types as a string, null, or an array of either.
 */
export function tabFromQuery(value: unknown): KitchenTab {
  const first =
    typeof value === 'string' ? value
    : Array.isArray(value) ? String(value[0] ?? '')
    : ''
  return KITCHEN_TABS.find((tab) => tab === first) ?? DEFAULT_KITCHEN_TAB
}

/**
 * Open to-dos that are overdue or due today (kitchen spec §4.2) — the badge on the main screen's Kitchen
 * button. `today` is the household's own date, so the count rolls over at household midnight.
 */
export function dueTaskCount(tasks: Task[] | undefined, today: HouseholdDate): number {
  return (tasks ?? []).filter((task) => task.doneAt === null && task.dueOn !== null && task.dueOn <= today).length
}
