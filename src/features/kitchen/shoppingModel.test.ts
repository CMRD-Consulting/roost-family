import { describe, expect, it } from 'vitest'
import type { GroceryItem, ShoppingList } from '@/data/snapshot'
import {
  MAX_ITEMS_PER_LIST, MAX_LISTS, buildShoppingModel, checkedItems, cleanListName, shoppingChips,
} from './shoppingModel'

const NOW = new Date('2026-09-14T19:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const HOUR = 3_600_000

const list = (id: string, name: string, createdAgo: number, archivedAt: string | null = null): ShoppingList => ({
  id, name, createdAt: ago(createdAgo), archivedAt,
})
const item = (id: string, listId: string, createdAgo: number, checkedAgo: number | null = null): GroceryItem => ({
  id, listId, text: id, createdAt: ago(createdAgo), checkedAt: checkedAgo === null ? null : ago(checkedAgo),
})

const LISTS = [list('costco', 'Costco', 10 * HOUR), list('groceries', 'Groceries', 100 * HOUR)]
const ITEMS = [
  item('milk', 'groceries', 5 * HOUR),
  item('eggs', 'groceries', 9 * HOUR),
  item('bread', 'groceries', 7 * HOUR, 2 * HOUR),
  item('old', 'groceries', 80 * HOUR, 40 * HOUR),
  item('bananas', 'costco', 3 * HOUR),
]

describe('shoppingChips', () => {
  it('lists un-archived lists oldest first with their open counts', () => {
    expect(shoppingChips(LISTS, ITEMS)).toEqual([
      { id: 'groceries', name: 'Groceries', openCount: 2 },
      { id: 'costco', name: 'Costco', openCount: 1 },
    ])
  })

  it('leaves out archived lists, and copes with a snapshot from before the Kitchen screen', () => {
    const archived = [...LISTS, list('old', 'Hardware', 5 * HOUR, ago(HOUR))]
    expect(shoppingChips(archived, ITEMS).map((c) => c.id)).toEqual(['groceries', 'costco'])
    expect(shoppingChips(undefined, ITEMS)).toEqual([])
  })

  it('breaks a createdAt tie by id, so the order never shuffles between renders', () => {
    const tied = [list('b', 'B', HOUR), list('a', 'A', HOUR)]
    expect(shoppingChips(tied, []).map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('buildShoppingModel', () => {
  it('shows the asked-for list: unchecked oldest-first, then items checked in the last 24 h', () => {
    const model = buildShoppingModel(LISTS, ITEMS, 'groceries', NOW)
    expect(model.selectedId).toBe('groceries')
    expect(model.selectedName).toBe('Groceries')
    expect(model.items.map((i) => i.id)).toEqual(['eggs', 'milk', 'bread'])
    // `old` was checked two days ago: off the screen, but still on the list for the 200-item limit.
    expect(model.itemCount).toBe(4)
  })

  it('falls back to the household default list when none is asked for, or the one asked for has gone', () => {
    expect(buildShoppingModel(LISTS, ITEMS, null, NOW).selectedId).toBe('groceries')
    expect(buildShoppingModel(LISTS, ITEMS, 'archived-list', NOW).selectedId).toBe('groceries')
  })

  it('has no list and no items for a household whose lists have not loaded', () => {
    const model = buildShoppingModel(undefined, [], null, NOW)
    expect(model.selectedId).toBeNull()
    expect(model.items).toEqual([])
    expect(model.canArchive).toBe(false)
  })

  it('refuses to archive the last list', () => {
    expect(buildShoppingModel(LISTS, ITEMS, 'costco', NOW).canArchive).toBe(true)
    expect(buildShoppingModel([LISTS[1]!], ITEMS, null, NOW).canArchive).toBe(false)
  })

  it('stops at 6 lists and 200 items', () => {
    const six = Array.from({ length: MAX_LISTS }, (_, i) => list(`l${i}`, `List ${i}`, (i + 1) * HOUR))
    expect(buildShoppingModel(six.slice(0, 5), [], null, NOW).canAddList).toBe(true)
    expect(buildShoppingModel(six, [], null, NOW).canAddList).toBe(false)

    const full = Array.from({ length: MAX_ITEMS_PER_LIST }, (_, i) => item(`i${i}`, 'groceries', HOUR))
    expect(buildShoppingModel(LISTS, full.slice(0, 199), 'groceries', NOW).canAddItem).toBe(true)
    expect(buildShoppingModel(LISTS, full, 'groceries', NOW).canAddItem).toBe(false)
  })
})

describe('checkedItems', () => {
  it('picks the checked rows on screen', () => {
    const shown = buildShoppingModel(LISTS, ITEMS, 'groceries', NOW).items
    expect(checkedItems(shown).map((i) => i.id)).toEqual(['bread'])
  })
})

describe('cleanListName', () => {
  it('trims, collapses runs of spaces and caps at 40 characters', () => {
    expect(cleanListName('  Hardware   store  ')).toBe('Hardware store')
    expect(cleanListName('   ')).toBe('')
    expect(cleanListName('x'.repeat(60))).toHaveLength(40)
  })
})
