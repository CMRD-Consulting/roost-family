<script setup lang="ts">
/**
 * Recipes tab (kitchen spec §5.2): a grid of recipe cards newest-first with a search field once the box
 * outgrows a glance, and a recipe view with its ingredients and steps sized to read from across the kitchen.
 * The source URL is shown as plain text and never opened — this is a wall tablet, not a browser.
 *
 * Reads come from the snapshot, so the box is there offline; authoring needs a connection (§7.2, §8), so
 * offline the editing actions give way to "Recipes need a connection." Adding ingredients to a list and
 * planning a day are ordinary log commands, so they keep working and queue.
 */
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import type { LogCommand } from '@/data/logCommands'
import { RecipeError, loadRecipeApi } from '@/data/recipeApi'
import type { Recipe } from '@/data/snapshot'
import { householdDate } from '@/domain/time'
import SheetError from '@/features/logs/SheetError.vue'
import { useLogSheet } from '@/features/logs/useLogSheet'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import AddIngredientsSheet from './AddIngredientsSheet.vue'
import PlanDaySheet from './PlanDaySheet.vue'
import RecipeEditor from './RecipeEditor.vue'
import { buildMealsModel } from './mealsModel'
import {
  EMPTY_RECIPES_MESSAGE, MAX_TITLE, NO_MATCH_MESSAGE, OFFLINE_MESSAGE, RECIPE_LIMIT_MESSAGE,
  buildRecipesModel, ingredientsLabel, lineTexts, recipeErrorMessage, servingsLabel, visibleRecipes,
} from './recipesModel'

/** The Kitchen screen holds Night Mode off while one of this tab's sheets is open (design §7.7). */
const emit = defineEmits<{ 'sheet-open': [open: boolean] }>()

const { view, displayId, error, submit } = useLogSheet()
const household = useHouseholdStore()
// Only the household's own date depends on the clock, and it changes once a day.
const now = useNow(60_000)

const query = ref('')
/** The recipe being read, or null on the grid. */
const openId = ref<string | null>(null)
/** The recipe being written; `'new'` while the editor is creating one. */
const editing = ref<Recipe | 'new' | null>(null)
const addingIngredients = ref(false)
const planning = ref(false)
/** Archive awaiting its second tap (kitchen spec §5.2). */
const confirmingArchive = ref(false)
/** A limit or a failed archive, shown inline beside the actions (§8). */
const notice = ref<string | null>(null)

/** Recipe authoring is online only, as Settings is: both the household's connection and the device's count. */
const offline = computed(() => !household.online || (typeof navigator !== 'undefined' && navigator.onLine === false))

const model = computed(() => buildRecipesModel(view.value?.recipes, query.value))
const current = computed(() => visibleRecipes(view.value?.recipes).find((r) => r.id === openId.value) ?? null)

const today = computed(() => householdDate(now.value, view.value?.household.timeZone ?? 'UTC'))
/** "Plan this" offers the same seven days the Meals tab shows. */
const days = computed(() => buildMealsModel(view.value?.mealPlan, view.value?.recipes, today.value))

const sheetOpen = computed(() => editing.value !== null || addingIngredients.value || planning.value)
watch(sheetOpen, (open) => emit('sheet-open', open), { immediate: true })

/** Moving between recipes drops a half-made confirmation and any inline notice. */
watch(openId, () => {
  confirmingArchive.value = false
  notice.value = null
})

function open(id: string): void {
  openId.value = id
}

function back(): void {
  openId.value = null
}

function newRecipe(): void {
  if (!model.value.canAddRecipe) {
    notice.value = RECIPE_LIMIT_MESSAGE
    return
  }
  notice.value = null
  editing.value = 'new'
}

function saved(recipeId: string): void {
  editing.value = null
  openId.value = recipeId
}

async function runCommands(cmds: LogCommand[]): Promise<void> {
  addingIngredients.value = false
  planning.value = false
  for (const cmd of cmds) {
    if ((await submit(cmd)) === null) return
  }
}

async function archive(): Promise<void> {
  const recipe = current.value
  if (recipe === null) return
  if (!confirmingArchive.value) {
    confirmingArchive.value = true
    return
  }
  confirmingArchive.value = false
  notice.value = null
  try {
    await (await loadRecipeApi()).archiveRecipe(recipe.id)
    openId.value = null
    void household.reload().catch(() => {})
  } catch (e) {
    notice.value = recipeErrorMessage(e instanceof RecipeError ? e.code : 'other')
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <SheetError :message="error" />

    <!-- The recipe box. -->
    <template v-if="current === null">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <RInput
          v-if="model.showSearch"
          v-model="query"
          data-testid="recipe-search"
          label="Search recipes"
          :maxlength="MAX_TITLE"
          class="w-[420px] max-w-full"
        />
        <RButton v-if="!offline" tier="moment" data-testid="new-recipe" @click="newRecipe">+ New recipe</RButton>
        <p v-else class="text-[18px] font-medium text-ink-2" data-testid="recipes-offline">{{ OFFLINE_MESSAGE }}</p>
      </div>

      <p v-if="notice" role="status" data-testid="recipe-notice" class="text-[18px] font-medium text-warn-ink">
        {{ notice }}
      </p>

      <p v-if="model.total === 0" class="text-[24px] text-ink-2">{{ EMPTY_RECIPES_MESSAGE }}</p>
      <p v-else-if="model.cards.length === 0" class="text-[24px] text-ink-2">{{ NO_MATCH_MESSAGE }}</p>
      <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <li v-for="card in model.cards" :key="card.id">
          <button
            type="button"
            data-testid="recipe-card"
            class="flex min-h-[124px] w-full flex-col items-start justify-between gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
            @click="open(card.id)"
          >
            <span class="text-[24px] font-semibold text-ink">{{ card.title }}</span>
            <span class="text-[18px] text-ink-2">
              {{ ingredientsLabel(card.ingredientCount) }}<template v-if="servingsLabel(card.servings)">
                · {{ servingsLabel(card.servings) }}</template>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <!-- One recipe. -->
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <RButton variant="secondary" tier="moment" data-testid="recipes-back" @click="back">← All recipes</RButton>
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="text-[32px] font-semibold text-ink">{{ current.title }}</h2>
        <p v-if="servingsLabel(current.servings)" class="text-[20px] text-ink-2">
          {{ servingsLabel(current.servings) }}
        </p>
        <!-- Shown as text, never a link: a wall tablet has nowhere to open it (kitchen spec §5.2). -->
        <p v-if="current.sourceUrl" data-testid="recipe-source-text" class="text-[18px] break-all text-ink-2">
          From {{ current.sourceUrl }}
        </p>
        <p v-if="current.notes" class="whitespace-pre-line text-[20px] text-ink-2">{{ current.notes }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <RButton
          variant="secondary"
          tier="moment"
          data-testid="add-ingredients-open"
          :disabled="current.ingredients.length === 0"
          @click="addingIngredients = true"
        >
          Add ingredients to a list
        </RButton>
        <RButton variant="secondary" tier="moment" data-testid="plan-this" @click="planning = true">
          Plan this
        </RButton>
        <template v-if="!offline">
          <RButton variant="secondary" tier="moment" data-testid="edit-recipe" @click="editing = current">
            Edit
          </RButton>
          <RButton variant="secondary" tier="moment" data-testid="archive-recipe" @click="archive">
            {{ confirmingArchive ? 'Archive — tap again' : 'Archive' }}
          </RButton>
        </template>
        <p v-else class="text-[18px] font-medium text-ink-2" data-testid="recipes-offline">{{ OFFLINE_MESSAGE }}</p>
      </div>

      <p v-if="notice" role="status" data-testid="recipe-notice" class="text-[18px] font-medium text-warn-ink">
        {{ notice }}
      </p>

      <section class="flex flex-col gap-3">
        <h3 class="text-[24px] font-semibold text-ink">Ingredients</h3>
        <p v-if="current.ingredients.length === 0" class="text-[18px] text-ink-2">Nothing listed yet.</p>
        <ul v-else class="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface px-6 py-5">
          <li v-for="(text, i) in lineTexts(current.ingredients)" :key="i" class="text-[22px] text-ink">
            {{ text }}
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-[24px] font-semibold text-ink">Steps</h3>
        <p v-if="current.steps.length === 0" class="text-[18px] text-ink-2">No steps written down.</p>
        <ol v-else class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
          <li v-for="(text, i) in lineTexts(current.steps)" :key="i" class="flex gap-4 text-[26px] text-ink">
            <span class="shrink-0 font-semibold text-ink-2">{{ i + 1 }}.</span>
            <span>{{ text }}</span>
          </li>
        </ol>
      </section>

      <AddIngredientsSheet
        v-if="view"
        :open="addingIngredients"
        :household-id="view.household.id"
        :display-id="displayId"
        :lists="view.shoppingLists ?? []"
        :ingredients="current.ingredients"
        @close="addingIngredients = false"
        @submit="runCommands"
      />

      <PlanDaySheet
        v-if="view"
        :open="planning"
        :household-id="view.household.id"
        :days="days"
        :recipe="current"
        @close="planning = false"
        @submit="runCommands([$event])"
      />
    </template>

    <RecipeEditor
      v-if="view"
      :open="editing !== null"
      :household-id="view.household.id"
      :recipe="editing === 'new' ? null : editing"
      @close="editing = null"
      @saved="saved"
    />
  </div>
</template>
