<script setup lang="ts">
/**
 * Edit tonight's dinner: today's meal-plan entry (spec §5.5). `households.dinner_tonight` is no longer read or
 * written. A day planned from the recipe box is shown read-only here and changed on the Kitchen screen.
 */
import { computed, ref, watch } from 'vue'
import type { MealPlanEntry } from '@/data/snapshot'
import { householdDate } from '@/domain/time'
import type { HouseholdDate } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import SheetError from './SheetError.vue'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const MAX_LENGTH = 80

const { view, busy, error, submit, clearError } = useLogSheet()
const text = ref('')
/** Fixed when the sheet opens so the day can't shift under an open sheet at household midnight. */
const openedAt = ref(Date.now())

const today = computed<HouseholdDate | null>(() =>
  view.value ? householdDate(new Date(openedAt.value), view.value.household.timeZone) : null,
)
const current = computed<MealPlanEntry | null>(() => {
  const day = today.value
  return day === null ? null : (view.value?.mealPlan?.find((e) => e.day === day) ?? null)
})
/** Planned from the recipe box: the title is read-only here, with Clear the only action (spec §5.5). */
const fromRecipe = computed(() => current.value?.recipeId != null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    openedAt.value = Date.now()
    text.value = current.value?.text ?? ''
    clearError()
  },
  { immediate: true },
)

const trimmed = computed(() => text.value.trim().slice(0, MAX_LENGTH))
const canSave = computed(
  () => !busy.value && !fromRecipe.value && trimmed.value.length > 0 && trimmed.value !== current.value?.text,
)
const canClear = computed(() => !busy.value && current.value !== null)

async function save(): Promise<void> {
  const day = today.value
  if (!canSave.value || !view.value || day === null) return
  const previous = current.value
  const result = await submit({
    kind: 'meal.set',
    householdId: view.value.household.id,
    day,
    text: trimmed.value,
    recipeId: null,
    previous: previous ? { text: previous.text, recipeId: previous.recipeId } : null,
  })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}

async function clear(): Promise<void> {
  const day = today.value
  const previous = current.value
  if (!canClear.value || !view.value || day === null || !previous) return
  const result = await submit({
    kind: 'meal.clear',
    householdId: view.value.household.id,
    day,
    previous: { text: previous.text, recipeId: previous.recipeId },
  })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}
</script>

<template>
  <RSheet title="Dinner" :open="open" @close="emit('close')">
    <div v-if="fromRecipe" class="flex flex-col gap-3">
      <p class="text-[18px] text-ink-3">Tonight's dinner</p>
      <p class="text-[24px] font-medium text-ink">{{ current?.text }}</p>
      <p class="text-[18px] text-ink-2">Planned from the recipe box. Change it on the Kitchen screen.</p>
      <SheetError :message="error" />
    </div>
    <form v-else class="flex flex-col gap-4" @submit.prevent="save">
      <RInput v-model="text" label="Tonight's dinner" :maxlength="MAX_LENGTH" />
      <SheetError :message="error" />
    </form>

    <template #footer>
      <div class="flex gap-3">
        <RButton variant="secondary" tier="moment" class="flex-1" :disabled="!canClear" @click="clear">Clear</RButton>
        <RButton v-if="!fromRecipe" tier="moment" class="flex-[2]" :disabled="!canSave" @click="save">Save</RButton>
      </div>
    </template>
  </RSheet>
</template>
