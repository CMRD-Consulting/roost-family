<script setup lang="ts">
/**
 * Shopping tab (kitchen spec §3.2): a chip per un-archived list with its open count, the selected list's
 * items (unchecked oldest-first, then the last 24 h of checked ones), and the list's header actions —
 * Rename, Clear checked, Archive list and Take list. No PIN here (§2); Clear checked and Archive each take a
 * second confirming tap, and limits are shown inline, never as a dialog (§8).
 */
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { newId, type LogCommand } from '@/data/logCommands'
import type { GroceryItem, ShoppingList } from '@/data/snapshot'
import SheetError from '@/features/logs/SheetError.vue'
import { useLogSheet } from '@/features/logs/useLogSheet'
import TakeListQr from '@/features/takelist/TakeListQr.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import ListNameSheet from './ListNameSheet.vue'
import {
  EMPTY_LIST_MESSAGE, ITEM_LIMIT_MESSAGE, LAST_LIST_MESSAGE, LIST_LIMIT_MESSAGE, MAX_ITEM_TEXT,
  buildShoppingModel, checkedItems,
} from './shoppingModel'

/** The Kitchen screen holds Night Mode off while one of this tab's sheets is open (design §7.7). */
const emit = defineEmits<{ 'sheet-open': [open: boolean] }>()

const { view, displayId, error, submit, clearError } = useLogSheet()
// Only the 24-hour "checked recently" window depends on the clock, so a slow tick is plenty.
const now = useNow(60_000)

/** The list an adult picked; null means the household's default (its oldest list). */
const requestedListId = ref<string | null>(null)
const draft = ref('')
const naming = ref<'new' | 'rename' | null>(null)
const takeListOpen = ref(false)
/** The destructive action awaiting its second tap. */
const confirming = ref<'archive' | 'clear' | null>(null)
/** A limit or rule, shown inline beside the actions. */
const notice = ref<string | null>(null)

const model = computed(() =>
  buildShoppingModel(view.value?.shoppingLists, view.value?.groceries ?? [], requestedListId.value, now.value),
)

const sheetOpen = computed(() => naming.value !== null || takeListOpen.value)
watch(sheetOpen, (open) => emit('sheet-open', open), { immediate: true })

/** Switching lists drops a half-made confirmation and any inline notice. */
watch(() => model.value.selectedId, () => {
  confirming.value = null
  notice.value = null
})

async function run(cmd: LogCommand): Promise<boolean> {
  return (await submit(cmd)) !== null
}

function select(listId: string): void {
  requestedListId.value = listId
  draft.value = ''
  clearError()
}

async function add(): Promise<void> {
  const text = draft.value.trim().slice(0, MAX_ITEM_TEXT)
  const listId = model.value.selectedId
  if (!view.value || listId === null || text.length === 0) return
  if (!model.value.canAddItem) {
    notice.value = ITEM_LIMIT_MESSAGE
    return
  }
  notice.value = null
  draft.value = ''
  const item: GroceryItem = { id: newId(), listId, text, createdAt: new Date().toISOString(), checkedAt: null }
  const ok = await run({ kind: 'grocery.add', householdId: view.value.household.id, item, displayId: displayId.value })
  // Failed and nothing typed since: give the words back rather than losing them.
  if (!ok && draft.value === '') draft.value = text
}

async function toggle(item: GroceryItem): Promise<void> {
  if (!view.value) return
  await run({
    kind: 'grocery.check',
    householdId: view.value.household.id,
    itemId: item.id,
    checkedAt: item.checkedAt === null ? new Date().toISOString() : null,
    previousCheckedAt: item.checkedAt,
  })
}

async function remove(item: GroceryItem): Promise<void> {
  if (!view.value) return
  await run({ kind: 'grocery.delete', householdId: view.value.household.id, item, displayId: displayId.value })
}

async function clearChecked(): Promise<void> {
  if (confirming.value !== 'clear') {
    confirming.value = 'clear'
    return
  }
  confirming.value = null
  for (const item of checkedItems(model.value.items)) await remove(item)
}

async function archive(): Promise<void> {
  const listId = model.value.selectedId
  if (!view.value || listId === null) return
  if (!model.value.canArchive) {
    notice.value = LAST_LIST_MESSAGE
    return
  }
  if (confirming.value !== 'archive') {
    confirming.value = 'archive'
    return
  }
  confirming.value = null
  requestedListId.value = null
  await run({
    kind: 'list.archive',
    householdId: view.value.household.id,
    listId,
    archivedAt: new Date().toISOString(),
    previousArchivedAt: null,
  })
}

function openNewList(): void {
  if (!model.value.canAddList) {
    notice.value = LIST_LIMIT_MESSAGE
    return
  }
  notice.value = null
  naming.value = 'new'
}

async function saveName(name: string): Promise<void> {
  const mode = naming.value
  const current = model.value
  naming.value = null
  if (!view.value || mode === null) return
  if (mode === 'new') {
    const list: ShoppingList = { id: newId(), name, createdAt: new Date().toISOString(), archivedAt: null }
    // Selected first: the command applies optimistically, so the new list is on screen straight away.
    requestedListId.value = list.id
    if (!(await run({ kind: 'list.add', householdId: view.value.household.id, list }))) requestedListId.value = null
    return
  }
  if (current.selectedId === null) return
  await run({
    kind: 'list.rename',
    householdId: view.value.household.id,
    listId: current.selectedId,
    name,
    previousName: current.selectedName,
  })
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3" role="group" aria-label="Shopping lists">
      <button
        v-for="chip in model.chips"
        :key="chip.id"
        type="button"
        data-testid="list-chip"
        :aria-pressed="chip.id === model.selectedId"
        class="flex min-h-[60px] items-center gap-3 rounded-[var(--radius-control)] px-6 text-[22px] font-medium focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :class="chip.id === model.selectedId ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
        @click="select(chip.id)"
      >
        <span>{{ chip.name }}</span>
        <span class="text-[18px]" :class="chip.id === model.selectedId ? 'text-surface' : 'text-ink-2'">
          {{ chip.openCount }}
        </span>
      </button>
      <button
        type="button"
        class="min-h-[60px] rounded-[var(--radius-control)] border-2 border-dashed border-line px-6 text-[20px] font-medium text-ink-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        @click="openNewList"
      >
        + New list
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <RButton variant="secondary" tier="moment" :disabled="model.selectedId === null" @click="naming = 'rename'">
        Rename
      </RButton>
      <RButton
        variant="secondary"
        tier="moment"
        data-testid="clear-checked"
        :disabled="checkedItems(model.items).length === 0"
        @click="clearChecked"
      >
        {{ confirming === 'clear' ? 'Clear checked — tap again' : 'Clear checked' }}
      </RButton>
      <RButton
        variant="secondary"
        tier="moment"
        data-testid="archive-list"
        :disabled="!model.canArchive"
        @click="archive"
      >
        {{ confirming === 'archive' ? 'Archive — tap again' : 'Archive list' }}
      </RButton>
      <RButton variant="secondary" tier="moment" :disabled="model.selectedId === null" @click="takeListOpen = true">
        Take list
      </RButton>
    </div>

    <p v-if="!model.canArchive && model.selectedId !== null" class="text-[18px] text-ink-2">{{ LAST_LIST_MESSAGE }}</p>
    <p v-if="notice" role="status" data-testid="shopping-notice" class="text-[18px] font-medium text-warn-ink">
      {{ notice }}
    </p>

    <form class="flex items-end gap-3" @submit.prevent="add">
      <RInput
        v-model="draft"
        data-testid="shopping-add"
        :label="`Add to ${model.selectedName || 'the list'}`"
        :maxlength="MAX_ITEM_TEXT"
        class="flex-1"
      />
      <RButton type="submit" tier="moment" :disabled="draft.trim().length === 0 || model.selectedId === null">
        Add
      </RButton>
    </form>

    <SheetError :message="error" />

    <p v-if="model.items.length === 0" class="text-[24px] text-ink-2">{{ EMPTY_LIST_MESSAGE }}</p>
    <ul v-else class="flex flex-col rounded-[var(--radius-card)] bg-surface" :aria-label="`${model.selectedName} items`">
      <li
        v-for="item in model.items"
        :key="item.id"
        data-testid="shopping-item"
        class="flex items-center gap-2 border-b border-surface-2 px-2 last:border-b-0"
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
          <span class="text-[24px]" :class="item.checkedAt !== null ? 'text-ink-3 line-through' : 'text-ink'">
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

    <ListNameSheet
      :open="naming !== null"
      :title="naming === 'rename' ? 'Rename list' : 'New list'"
      :initial="naming === 'rename' ? model.selectedName : ''"
      @close="naming = null"
      @save="saveName"
    />
    <TakeListQr :open="takeListOpen" @close="takeListOpen = false" />
  </div>
</template>
