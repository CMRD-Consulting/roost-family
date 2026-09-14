<script setup lang="ts">
/** Grocery list (spec §7.4): add items, check them off, remove them. Stays open between actions. */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import type { GroceryItem } from '@/data/snapshot'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import SheetError from './SheetError.vue'
import { visibleGroceries } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const MAX_LENGTH = 100

const { view, displayId, error, submit, clearError } = useLogSheet()

const now = ref(new Date())
const draft = ref('')
const items = computed(() => (view.value ? visibleGroceries(view.value.groceries, now.value) : []))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    now.value = new Date()
    draft.value = ''
    clearError()
  },
  { immediate: true },
)

async function run(cmd: Parameters<typeof submit>[0]): Promise<boolean> {
  const result = await submit(cmd)
  if (result) emit('saved', result)
  return result !== null
}

async function add(): Promise<void> {
  const text = draft.value.trim().slice(0, MAX_LENGTH)
  if (!view.value || text.length === 0) return
  draft.value = ''
  const item: GroceryItem = { id: newId(), text, createdAt: new Date().toISOString(), checkedAt: null }
  const ok = await run({ kind: 'grocery.add', householdId: view.value.household.id, item, displayId: displayId.value })
  if (!ok && draft.value === '') draft.value = text
}

async function toggle(item: GroceryItem): Promise<void> {
  if (!view.value) return
  now.value = new Date()
  await run({
    kind: 'grocery.check',
    householdId: view.value.household.id,
    itemId: item.id,
    checkedAt: item.checkedAt === null ? now.value.toISOString() : null,
    previousCheckedAt: item.checkedAt,
  })
}

async function remove(item: GroceryItem): Promise<void> {
  if (!view.value) return
  await run({ kind: 'grocery.delete', householdId: view.value.household.id, item, displayId: displayId.value })
}
</script>

<template>
  <RSheet title="Grocery list" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-5">
      <form class="flex items-end gap-3" @submit.prevent="add">
        <RInput v-model="draft" label="Add an item" :maxlength="MAX_LENGTH" class="flex-1" />
        <RButton type="submit" tier="moment" :disabled="draft.trim().length === 0">Add</RButton>
      </form>

      <SheetError :message="error" />

      <p v-if="items.length === 0" class="text-[22px] text-ink-2">The list is empty.</p>
      <ul v-else class="flex flex-col rounded-[var(--radius-card)] bg-app" aria-label="Grocery items">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex items-center gap-2 border-b border-surface-2 px-2 last:border-b-0"
          data-testid="grocery-item"
        >
          <button
            type="button"
            role="checkbox"
            :aria-checked="item.checkedAt !== null"
            class="flex min-h-[60px] flex-1 items-center gap-4 px-2 text-left"
            @click="toggle(item)"
          >
            <span
              aria-hidden="true"
              class="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border-2 text-[16px] font-bold text-surface"
              :class="item.checkedAt !== null ? 'border-green-deep bg-green-deep' : 'border-ink-3 bg-transparent'"
            >
              {{ item.checkedAt !== null ? '✓' : '' }}
            </span>
            <span class="text-[22px]" :class="item.checkedAt !== null ? 'text-ink-3 line-through' : 'text-ink'">
              {{ item.text }}
            </span>
          </button>
          <button
            type="button"
            :aria-label="`Remove ${item.text}`"
            class="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-[var(--radius-control)] text-[24px] text-ink-2"
            @click="remove(item)"
          >
            ✕
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2">
        <RButton variant="secondary" tier="moment" class="w-full" disabled>Take list</RButton>
        <p class="text-center text-[18px] text-ink-3">Coming soon</p>
      </div>
    </template>
  </RSheet>
</template>
