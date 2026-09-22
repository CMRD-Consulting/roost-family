<script setup lang="ts">
/**
 * Push a recipe's ingredients onto a shopping list (kitchen spec §5.3): list chips defaulting to the
 * household's default list (its oldest un-archived one), a checkbox per ingredient with every one checked,
 * and a button labelled with the live count. Each checked ingredient becomes its own `grocery.add`, copied as
 * plain text with a fresh id — duplicates are allowed, and the commands queue offline like any other.
 */
import { computed, ref, watch } from 'vue'
import { newId, type LogCommand } from '@/data/logCommands'
import type { RecipeLine, ShoppingList } from '@/data/snapshot'
import RButton from '@/ui/RButton.vue'
import RSheet from '@/ui/RSheet.vue'
import { MAX_ITEM_TEXT, shoppingChips } from './shoppingModel'
import { cleanLine, lineTexts } from './recipesModel'

const props = defineProps<{
  open: boolean
  householdId: string
  displayId: string | null
  /** The household's shopping lists; archived ones are already left out of the snapshot. */
  lists: ShoppingList[]
  ingredients: RecipeLine[]
}>()
const emit = defineEmits<{ close: []; submit: [cmds: LogCommand[]] }>()

/** Oldest first, so the first chip is the household's default list (kitchen spec §3.1). */
const chips = computed(() => shoppingChips(props.lists, []))
const listId = ref<string | null>(null)
/** One flag per ingredient, in the recipe's own order. */
const checked = ref<boolean[]>([])

const texts = computed(() => lineTexts(props.ingredients).map((text) => cleanLine(text, MAX_ITEM_TEXT)))
const count = computed(() => texts.value.filter((_text, i) => checked.value[i] !== false).length)
const buttonLabel = computed(() => `Add ${count.value} ${count.value === 1 ? 'item' : 'items'}`)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    listId.value = chips.value[0]?.id ?? null
    checked.value = texts.value.map(() => true)
  },
  { immediate: true },
)

function toggle(index: number): void {
  const next = checked.value.slice()
  next[index] = next[index] === false
  checked.value = next
}

function add(): void {
  const list = listId.value
  if (list === null) return
  const createdAt = new Date().toISOString()
  const cmds = texts.value
    .filter((text, i) => text.length > 0 && checked.value[i] !== false)
    .map<LogCommand>((text) => ({
      kind: 'grocery.add',
      householdId: props.householdId,
      item: { id: newId(), listId: list, text, createdAt, checkedAt: null },
      displayId: props.displayId,
    }))
  if (cmds.length === 0) return
  emit('submit', cmds)
}
</script>

<template>
  <RSheet title="Add ingredients to a list" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-3">
        <p class="text-[18px] font-medium text-ink-2">Which list</p>
        <div class="flex flex-wrap gap-3" role="group" aria-label="Which list">
          <button
            v-for="chip in chips"
            :key="chip.id"
            type="button"
            data-testid="ingredient-list-chip"
            :aria-pressed="chip.id === listId"
            class="min-h-[60px] rounded-[var(--radius-control)] px-6 text-[22px] font-medium focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            :class="chip.id === listId ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
            @click="listId = chip.id"
          >
            {{ chip.name }}
          </button>
        </div>
      </div>

      <ul class="flex flex-col rounded-[var(--radius-card)] bg-surface-2">
        <li v-for="(text, i) in texts" :key="`${i}-${text}`" class="border-b border-line last:border-b-0">
          <button
            type="button"
            role="checkbox"
            data-testid="ingredient-check"
            :aria-checked="checked[i] !== false"
            class="flex min-h-[60px] w-full items-center gap-4 px-5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click="toggle(i)"
          >
            <span
              aria-hidden="true"
              class="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border-2 text-[16px] font-bold text-surface"
              :class="checked[i] !== false ? 'border-green-deep bg-green-deep' : 'border-ink-3 bg-transparent'"
            >
              {{ checked[i] !== false ? '✓' : '' }}
            </span>
            <span class="text-[24px] text-ink">{{ text }}</span>
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <RButton
        tier="moment"
        class="w-full"
        data-testid="add-ingredients"
        :disabled="count === 0 || listId === null"
        @click="add"
      >
        {{ buttonLabel }}
      </RButton>
    </template>
  </RSheet>
</template>
