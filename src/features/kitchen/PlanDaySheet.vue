<script setup lang="ts">
/**
 * Plan one day's dinner (kitchen spec §5.4): choose a recipe from a searchable list, type it, or clear it.
 * Opened from a day on the Meals tab (one day, every choice) and from "Plan this" on a recipe (that recipe,
 * a day picker of the next seven days).
 *
 * Choosing a recipe writes its title into the command's `text` as well as its id, because a meal-plan entry
 * always carries the label it shows (§5.1) — so archiving the recipe later never empties the plan. Every
 * command carries the day's previous state, which is what its inverse replays.
 */
import { computed, ref, watch } from 'vue'
import type { LogCommand } from '@/data/logCommands'
import type { Recipe } from '@/data/snapshot'
import RButton from '@/ui/RButton.vue'
import RChips, { type ChipOption } from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import { MAX_MEAL_TEXT, NOT_PLANNED, cleanMealText, type MealDayCard } from './mealsModel'
import { MAX_TITLE, NO_MATCH_MESSAGE, ingredientsLabel, matches, visibleRecipes } from './recipesModel'

const props = withDefaults(
  defineProps<{
    open: boolean
    householdId: string
    /** The days on offer: the one that was tapped, or the next seven when a recipe is being planned. */
    days: MealDayCard[]
    /** The recipe box, for "Choose a recipe". Ignored when `recipe` is set. */
    recipes?: Recipe[]
    /** "Plan this": the recipe is fixed and the day is chosen. Null on the Meals tab. */
    recipe?: Recipe | null
  }>(),
  { recipes: () => [], recipe: null },
)
const emit = defineEmits<{ close: []; submit: [cmd: LogCommand] }>()

const day = ref<string | null>(null)
const query = ref('')
const draft = ref('')

const card = computed<MealDayCard | null>(() => props.days.find((d) => d.day === day.value) ?? null)
/** Exactly what the entry holds, so an inverse replays the plan as it was. */
const previous = computed(() => card.value?.planned ?? null)

const dayOptions = computed<ChipOption[]>(() =>
  props.days.map((d) => ({ value: d.day, label: d.weekdayLabel, detail: d.dateLabel })),
)

const choosable = computed(() => visibleRecipes(props.recipes).filter((r) => matches(r, query.value)))

const title = computed(() => {
  if (props.recipe) return `Plan ${props.recipe.title}`
  const on = card.value
  return on ? `Dinner — ${on.weekdayLabel}, ${on.dateLabel}` : 'Dinner'
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    day.value = props.days[0]?.day ?? null
    query.value = ''
    // Editing a typed-in dinner starts from what it says; one planned from a recipe starts empty.
    const planned = props.days[0]?.planned ?? null
    draft.value = planned && planned.recipeId === null ? planned.text : ''
  },
  { immediate: true },
)

/** Switching days on the picker brings that day's own free text along. */
watch(day, () => {
  if (props.recipe) return
  const planned = card.value?.planned ?? null
  draft.value = planned && planned.recipeId === null ? planned.text : ''
})

function set(text: string, recipeId: string | null): void {
  const on = day.value
  const clean = cleanMealText(text)
  if (on === null || clean.length === 0) return
  emit('submit', {
    kind: 'meal.set',
    householdId: props.householdId,
    day: on,
    text: clean,
    recipeId,
    previous: previous.value,
  })
}

function clear(): void {
  const on = day.value
  const was = previous.value
  if (on === null || was === null) return
  emit('submit', { kind: 'meal.clear', householdId: props.householdId, day: on, previous: was })
}
</script>

<template>
  <RSheet :title="title" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-7">
      <div v-if="days.length > 1" class="flex flex-col gap-3">
        <p class="text-[18px] font-medium text-ink-2">Which day</p>
        <RChips v-model="day" label="Which day" :options="dayOptions" />
      </div>

      <p v-if="card" class="text-[18px] text-ink-2" data-testid="plan-current">
        <span v-if="card.planned">Planned: {{ card.planned.text }}</span>
        <span v-else>{{ NOT_PLANNED }}</span>
      </p>

      <!-- "Plan this": the recipe is already chosen, so the only question is which day. -->
      <RButton
        v-if="recipe"
        tier="moment"
        class="self-start"
        data-testid="plan-recipe-confirm"
        :disabled="day === null"
        @click="set(recipe.title, recipe.id)"
      >
        Plan it
      </RButton>

      <template v-else>
        <section class="flex flex-col gap-3">
          <h3 class="text-[24px] font-semibold text-ink">Choose a recipe</h3>
          <RInput v-model="query" data-testid="plan-search" label="Search recipes" :maxlength="MAX_TITLE" />
          <p v-if="choosable.length === 0" class="text-[18px] text-ink-2">{{ NO_MATCH_MESSAGE }}</p>
          <ul v-else class="flex flex-col rounded-[var(--radius-card)] bg-surface-2">
            <li v-for="option in choosable" :key="option.id" class="border-b border-line last:border-b-0">
              <button
                type="button"
                data-testid="plan-recipe"
                class="flex min-h-[60px] w-full items-center justify-between gap-4 px-5 text-left text-[24px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                @click="set(option.title, option.id)"
              >
                <span>{{ option.title }}</span>
                <span class="shrink-0 text-[18px] text-ink-2">{{ ingredientsLabel(option.ingredients.length) }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-3">
          <h3 class="text-[24px] font-semibold text-ink">Type it</h3>
          <form class="flex items-end gap-3" @submit.prevent="set(draft, null)">
            <RInput
              v-model="draft"
              data-testid="plan-text"
              label="Dinner"
              :maxlength="MAX_MEAL_TEXT"
              class="flex-1"
            />
            <RButton type="submit" tier="moment" :disabled="cleanMealText(draft).length === 0">Save</RButton>
          </form>
        </section>

        <RButton
          v-if="previous"
          variant="secondary"
          tier="moment"
          class="self-start"
          data-testid="plan-clear"
          @click="clear"
        >
          Clear
        </RButton>
      </template>
    </div>
  </RSheet>
</template>
