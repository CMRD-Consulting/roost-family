/**
 * Shopping tab (kitchen spec §3.2): the un-archived lists as chips with their open counts, the selected
 * list's visible items, and the per-household limits (§2, §8). Pure — no Vue, no stores.
 */
import type { GroceryItem, ShoppingList } from '@/data/snapshot'
import { visibleGroceries } from '@/features/logs/logSheetModel'

export const MAX_LISTS = 6
export const MAX_ITEMS_PER_LIST = 200
/** Matches the `shopping_lists.name` check constraint (kitchen spec §6). */
export const MAX_LIST_NAME = 40
export const MAX_ITEM_TEXT = 100

// Limits and the last-list rule are shown inline, never as a blocking dialog (kitchen spec §8).
export const LIST_LIMIT_MESSAGE = '6 lists is the maximum.'
export const ITEM_LIMIT_MESSAGE = 'This list holds 200 items.'
export const LAST_LIST_MESSAGE = 'A household keeps at least one list.'
export const EMPTY_LIST_MESSAGE = 'Nothing on this list yet.'

export interface ShoppingListChip {
  id: string
  name: string
  /** Items on the list that are still unchecked — what the chip shows. */
  openCount: number
}

export interface ShoppingModel {
  chips: ShoppingListChip[]
  /** The list actually shown: the one asked for, else the household's default (its oldest list). */
  selectedId: string | null
  selectedName: string
  /** The selected list's rows: unchecked oldest-first, then items checked in the last 24 h. */
  items: GroceryItem[]
  /** Every item on the selected list, checked or not — what the 200-item limit counts. */
  itemCount: number
  /** False for the last un-archived list: a household keeps at least one (kitchen spec §3.1). */
  canArchive: boolean
  canAddList: boolean
  canAddItem: boolean
}

/** Un-archived lists oldest-first (`createdAt`, then `id` so the order is stable), each with its open count. */
export function shoppingChips(lists: ShoppingList[] | undefined, items: GroceryItem[]): ShoppingListChip[] {
  return (lists ?? [])
    .filter((list) => list.archivedAt === null)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
    .map((list) => ({
      id: list.id,
      name: list.name,
      openCount: items.filter((item) => item.listId === list.id && item.checkedAt === null).length,
    }))
}

export function buildShoppingModel(
  lists: ShoppingList[] | undefined,
  items: GroceryItem[],
  requestedListId: string | null,
  now: Date,
): ShoppingModel {
  const chips = shoppingChips(lists, items)
  // A list that was just archived (or is not in this snapshot) falls back to the household's default list.
  const selected = chips.find((chip) => chip.id === requestedListId) ?? chips[0] ?? null
  const mine = selected === null ? [] : items.filter((item) => item.listId === selected.id)
  return {
    chips,
    selectedId: selected?.id ?? null,
    selectedName: selected?.name ?? '',
    items: visibleGroceries(mine, now),
    itemCount: mine.length,
    canArchive: chips.length > 1,
    canAddList: chips.length < MAX_LISTS,
    canAddItem: mine.length < MAX_ITEMS_PER_LIST,
  }
}

/** The rows "Clear checked" removes: the checked ones among those on screen. */
export function checkedItems(items: GroceryItem[]): GroceryItem[] {
  return items.filter((item) => item.checkedAt !== null)
}

/** A list name as it is saved: trimmed and capped. Empty means "don't save". */
export function cleanListName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_LIST_NAME)
}
