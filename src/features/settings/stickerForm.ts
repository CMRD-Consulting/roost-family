import type { StickerCategoryInput } from '@/data/settingsApi'
import type { StickerCategory } from '@/data/snapshot'

/** Mirrored from the database check on `upsert_sticker_category`. */
export const STICKER_NAME_MAX = 30

export interface StickerCategoryForm {
  name: string
  iconKey: string | null
}

export function emptyStickerCategoryForm(): StickerCategoryForm {
  return { name: '', iconKey: null }
}

export function stickerCategoryFormFrom(category: StickerCategory): StickerCategoryForm {
  return { name: category.name, iconKey: category.iconKey }
}

export type StickerCategoryFormErrors = Partial<Record<'name' | 'iconKey', string>>

export function validateStickerCategoryForm(form: StickerCategoryForm): StickerCategoryFormErrors {
  const errors: StickerCategoryFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give this category a name.'
  else if ([...name].length > STICKER_NAME_MAX) errors.name = `Names can be up to ${STICKER_NAME_MAX} characters.`
  if (!form.iconKey) errors.iconKey = 'Pick an icon.'
  return errors
}

export function toStickerCategoryInput(
  categoryId: string | null, form: StickerCategoryForm, sortOrder: number | null,
): StickerCategoryInput {
  return { categoryId, name: form.name.trim(), iconKey: form.iconKey ?? '', sortOrder }
}

/** New order after moving the category at `index` one step up (`-1`) or down (`1`); null off the ends. */
export function reorderedSortOrders(categories: StickerCategory[], index: number, direction: -1 | 1): { id: string; sortOrder: number }[] | null {
  const target = index + direction
  if (target < 0 || target >= categories.length) return null
  const a = categories[index]!
  const b = categories[target]!
  return [
    { id: a.id, sortOrder: b.sortOrder },
    { id: b.id, sortOrder: a.sortOrder },
  ]
}
