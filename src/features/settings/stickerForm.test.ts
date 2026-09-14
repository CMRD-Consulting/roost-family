import { describe, expect, it } from 'vitest'
import type { StickerCategory } from '@/data/snapshot'
import {
  emptyStickerCategoryForm, reorderedSortOrders, stickerCategoryFormFrom, toStickerCategoryInput, validateStickerCategoryForm,
} from './stickerForm'

const potty: StickerCategory = { id: 'c1', name: 'Potty', iconKey: 'potty', sortOrder: 0 }
const teeth: StickerCategory = { id: 'c2', name: 'Teeth', iconKey: 'teeth', sortOrder: 1 }
const food: StickerCategory = { id: 'c3', name: 'Tried a new food', iconKey: 'snack', sortOrder: 2 }

describe('emptyStickerCategoryForm', () => {
  it('starts with no icon chosen', () => {
    expect(emptyStickerCategoryForm()).toEqual({ name: '', iconKey: null })
  })
})

describe('stickerCategoryFormFrom', () => {
  it('fills from a category', () => {
    expect(stickerCategoryFormFrom(potty)).toEqual({ name: 'Potty', iconKey: 'potty' })
  })
})

describe('validateStickerCategoryForm', () => {
  it('requires a name up to 30 characters and an icon', () => {
    expect(validateStickerCategoryForm({ name: '  ', iconKey: null })).toEqual({
      name: 'Give this category a name.',
      iconKey: 'Pick an icon.',
    })
    expect(validateStickerCategoryForm({ name: 'x'.repeat(31), iconKey: 'potty' })).toEqual({
      name: 'Names can be up to 30 characters.',
    })
    expect(validateStickerCategoryForm({ name: 'Potty', iconKey: 'potty' })).toEqual({})
  })
})

describe('toStickerCategoryInput', () => {
  it('trims the name and carries the id and sort order through', () => {
    expect(toStickerCategoryInput('c1', { name: '  Potty  ', iconKey: 'potty' }, 2)).toEqual({
      categoryId: 'c1', name: 'Potty', iconKey: 'potty', sortOrder: 2,
    })
  })
})

describe('reorderedSortOrders', () => {
  const categories = [potty, teeth, food]

  it('swaps sort orders with the previous category', () => {
    expect(reorderedSortOrders(categories, 1, -1)).toEqual([
      { id: 'c2', sortOrder: 0 },
      { id: 'c1', sortOrder: 1 },
    ])
  })

  it('swaps sort orders with the next category', () => {
    expect(reorderedSortOrders(categories, 1, 1)).toEqual([
      { id: 'c2', sortOrder: 2 },
      { id: 'c3', sortOrder: 1 },
    ])
  })

  it('returns null past either end', () => {
    expect(reorderedSortOrders(categories, 0, -1)).toBeNull()
    expect(reorderedSortOrders(categories, 2, 1)).toBeNull()
  })
})
