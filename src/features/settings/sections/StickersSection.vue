<script setup lang="ts">
/** Settings > Stickers (spec §7.4, §7.9): the sticker categories offered in the Sticker log, editable,
 *  reorderable and archivable. */
import { computed, ref } from 'vue'
import type { StickerCategory } from '@/data/snapshot'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RoutineIcon from '@/ui/RoutineIcon.vue'
import IconPicker from '../forms/IconPicker.vue'
import SaveRow from '../forms/SaveRow.vue'
import {
  emptyStickerCategoryForm, reorderedSortOrders, stickerCategoryFormFrom, toStickerCategoryInput,
  validateStickerCategoryForm, type StickerCategoryForm, type StickerCategoryFormErrors,
} from '../stickerForm'
import { useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()

const categories = computed<StickerCategory[]>(() =>
  store.view ? [...store.view.stickerCategories].sort((a, b) => a.sortOrder - b.sortOrder) : [],
)

// ─── Add / edit ────────────────────────────────────────────────────────────
const editingId = ref<string | null>(null) // null while not editing; '' means "adding new"
const form = ref<StickerCategoryForm | null>(null)
const errors = ref<StickerCategoryFormErrors>({})
const { saving, saved, error, offline, save } = useSettingsSave()

function startAdd(): void {
  editingId.value = ''
  form.value = emptyStickerCategoryForm()
  errors.value = {}
}

function startEdit(category: StickerCategory): void {
  editingId.value = category.id
  form.value = stickerCategoryFormFrom(category)
  errors.value = {}
}

function cancelForm(): void {
  editingId.value = null
  form.value = null
}

async function submit(): Promise<void> {
  const current = form.value
  if (!current) return
  errors.value = validateStickerCategoryForm(current)
  if (Object.keys(errors.value).length > 0) return
  const categoryId = editingId.value === '' ? null : editingId.value
  const existing = categoryId ? categories.value.find((c) => c.id === categoryId) : undefined
  const ok = await save((api, auth) =>
    api.upsertStickerCategory(auth, toStickerCategoryInput(categoryId, current, categoryId ? (existing?.sortOrder ?? null) : null)),
  )
  if (ok) cancelForm()
}

// ─── Reorder ───────────────────────────────────────────────────────────────
const { saving: reordering, save: saveReorder } = useSettingsSave()

async function move(index: number, direction: -1 | 1): Promise<void> {
  const swap = reorderedSortOrders(categories.value, index, direction)
  if (!swap || reordering.value) return
  for (const { id, sortOrder } of swap) {
    const category = categories.value.find((c) => c.id === id)
    if (!category) continue
    await saveReorder((api, auth) =>
      api.upsertStickerCategory(auth, toStickerCategoryInput(category.id, stickerCategoryFormFrom(category), sortOrder)),
    )
  }
}

// ─── Archive ───────────────────────────────────────────────────────────────
const archivingId = ref<string | null>(null)
const { saving: archiving, error: archiveError, save: saveArchive } = useSettingsSave()

async function confirmArchive(categoryId: string): Promise<void> {
  const ok = await saveArchive((api, auth) => api.archiveStickerCategory(auth, categoryId))
  if (ok) archivingId.value = null
}
</script>

<template>
  <section aria-labelledby="settings-stickers-title" class="flex flex-col gap-5">
    <div class="flex items-center justify-between gap-4">
      <h2 id="settings-stickers-title" class="text-[32px] font-semibold text-ink">Stickers</h2>
      <RButton v-if="editingId === null" variant="primary" @click="startAdd">+ Add category</RButton>
    </div>

    <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
      <ul class="flex flex-col">
        <li v-for="(category, i) in categories" :key="category.id" class="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
          <template v-if="archivingId === category.id">
            <p class="text-[20px] text-ink">Archive {{ category.name }}? Past stickers stay in Logs.</p>
            <div class="flex gap-3">
              <RButton variant="secondary" :disabled="archiving" @click="archivingId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="archiving" @click="confirmArchive(category.id)">Archive</RButton>
            </div>
            <p v-if="archiveError" role="alert" class="text-[18px] text-warn-ink">{{ archiveError }}</p>
          </template>
          <div v-else class="flex items-center gap-4">
            <span class="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-2 text-ink">
              <RoutineIcon :icon-key="category.iconKey" :size="28" />
            </span>
            <span class="flex-1 text-[22px] font-medium text-ink">{{ category.name }}</span>
            <div class="flex flex-col gap-1">
              <button
                type="button" :aria-label="`Move ${category.name} up`" :disabled="i === 0"
                class="flex size-11 items-center justify-center rounded-[12px] bg-surface-2 text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="move(i, -1)"
              >
                ↑
              </button>
              <button
                type="button" :aria-label="`Move ${category.name} down`" :disabled="i === categories.length - 1"
                class="flex size-11 items-center justify-center rounded-[12px] bg-surface-2 text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="move(i, 1)"
              >
                ↓
              </button>
            </div>
            <RButton variant="secondary" @click="startEdit(category)">Edit {{ category.name }}</RButton>
            <RButton variant="ghost" :aria-label="`Archive ${category.name}`" @click="archivingId = category.id">Archive</RButton>
          </div>
        </li>
        <li v-if="categories.length === 0" class="py-3 text-[18px] text-ink-3">No sticker categories yet.</li>
      </ul>
    </div>

    <div v-if="form" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[20px] font-semibold text-ink">{{ editingId === '' ? 'Add category' : 'Edit category' }}</h3>
      <div class="flex flex-col gap-2">
        <RInput v-model="form.name" label="Name" autocomplete="off" :maxlength="30" />
        <p v-if="errors.name" class="text-[18px] text-warn-ink">{{ errors.name }}</p>
      </div>
      <div class="flex flex-col gap-2">
        <IconPicker v-model="form.iconKey" label="Icon" />
        <p v-if="errors.iconKey" class="text-[18px] text-warn-ink">{{ errors.iconKey }}</p>
      </div>
      <div class="flex items-center gap-4">
        <RButton variant="secondary" @click="cancelForm">Cancel</RButton>
        <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline" @save="submit" />
      </div>
    </div>

    <p class="text-[18px] text-ink-3">The chart resets every Monday. Past weeks are kept in Logs.</p>
  </section>
</template>
