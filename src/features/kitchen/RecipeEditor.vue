<script setup lang="ts">
/**
 * Create or edit a recipe (kitchen spec §5.2): the four fields, then ingredient and step lines that add,
 * edit, reorder with ↑/↓ and remove. Recipes are the one part of the Kitchen that needs a connection (§7.2):
 * the write goes through `recipeApi` — the recipe itself, then its whole set of ingredients and steps — and a
 * failure is shown by its code, never in the server's own words.
 */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import { RecipeError, loadRecipeApi, type RecipeInput } from '@/data/recipeApi'
import type { Recipe } from '@/data/snapshot'
import SheetError from '@/features/logs/SheetError.vue'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import {
  MAX_INGREDIENTS, MAX_INGREDIENT_TEXT, MAX_NOTES, MAX_SOURCE_URL, MAX_STEPS, MAX_STEP_TEXT, MAX_TITLE,
  cleanLine, cleanNotes, cleanServings, lineTexts, limitNotice, moveLine, recipeErrorMessage, trimLines,
} from './recipesModel'

const props = defineProps<{
  open: boolean
  householdId: string
  /** The recipe being edited, or null to create one. */
  recipe: Recipe | null
}>()
const emit = defineEmits<{ close: []; saved: [recipeId: string] }>()

/** A line keeps a key of its own so reordering moves the row, not just the text in it. */
interface EditorLine {
  key: string
  text: string
}

const household = useHouseholdStore()

const title = ref('')
const servings = ref('')
const sourceUrl = ref('')
const notes = ref('')
const ingredients = ref<EditorLine[]>([])
const steps = ref<EditorLine[]>([])

const saving = ref(false)
const error = ref<string | null>(null)

const line = (text: string): EditorLine => ({ key: newId(), text })

const canSave = computed(() => !saving.value && cleanLine(title.value, MAX_TITLE).length > 0)
const notice = computed(() => limitNotice(ingredients.value.length, steps.value.length))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const recipe = props.recipe
    error.value = null
    saving.value = false
    title.value = recipe?.title ?? ''
    servings.value = recipe && recipe.servings !== null ? String(recipe.servings) : ''
    sourceUrl.value = recipe?.sourceUrl ?? ''
    notes.value = recipe?.notes ?? ''
    ingredients.value = recipe ? lineTexts(recipe.ingredients).map(line) : [line('')]
    steps.value = recipe ? lineTexts(recipe.steps).map(line) : [line('')]
  },
  { immediate: true },
)

function addIngredient(): void {
  if (ingredients.value.length >= MAX_INGREDIENTS) return
  ingredients.value = [...ingredients.value, line('')]
}

function addStep(): void {
  if (steps.value.length >= MAX_STEPS) return
  steps.value = [...steps.value, line('')]
}

function moveIngredient(index: number, direction: -1 | 1): void {
  ingredients.value = moveLine(ingredients.value, index, direction)
}

function moveStep(index: number, direction: -1 | 1): void {
  steps.value = moveLine(steps.value, index, direction)
}

function removeIngredient(index: number): void {
  ingredients.value = ingredients.value.filter((_row, i) => i !== index)
}

function removeStep(index: number): void {
  steps.value = steps.value.filter((_row, i) => i !== index)
}

async function save(): Promise<void> {
  const clean = cleanLine(title.value, MAX_TITLE)
  if (saving.value || clean.length === 0) return
  saving.value = true
  error.value = null
  try {
    const api = await loadRecipeApi()
    const input: RecipeInput = {
      title: clean,
      sourceUrl: cleanLine(sourceUrl.value, MAX_SOURCE_URL) || null,
      servings: cleanServings(servings.value),
      notes: cleanNotes(notes.value),
    }
    const id = props.recipe?.id ?? newId()
    if (props.recipe) await api.updateRecipe(id, input)
    else await api.createRecipe({ id, householdId: props.householdId, ...input })
    const target = { id, householdId: props.householdId }
    await api.setIngredients(target, trimLines(ingredients.value.map((row) => row.text), MAX_INGREDIENTS, MAX_INGREDIENT_TEXT))
    await api.setSteps(target, trimLines(steps.value.map((row) => row.text), MAX_STEPS, MAX_STEP_TEXT))
    // Recipes aren't log commands, so nothing applied them optimistically: re-read so the change shows at once
    // even when Realtime is slow. Not awaited — a failed reload is retried by the store's own refresh.
    void household.reload().catch(() => {})
    emit('saved', id)
  } catch (e) {
    error.value = recipeErrorMessage(e instanceof RecipeError ? e.code : 'other')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <RSheet :title="recipe ? 'Edit recipe' : 'New recipe'" :open="open" @close="emit('close')">
    <form class="flex flex-col gap-7" @submit.prevent="save">
      <div class="flex flex-wrap items-end gap-4">
        <RInput v-model="title" data-testid="recipe-title" label="Title" :maxlength="MAX_TITLE" class="flex-1" />
        <RInput
          v-model="servings"
          data-testid="recipe-servings"
          label="Serves"
          inputmode="numeric"
          :maxlength="2"
          class="w-[140px]"
        />
      </div>

      <RInput
        v-model="sourceUrl"
        data-testid="recipe-source"
        label="Where it came from"
        :maxlength="MAX_SOURCE_URL"
      />

      <label class="flex flex-col gap-2">
        <span class="text-[18px] font-medium text-ink-2">Notes</span>
        <textarea
          v-model="notes"
          data-testid="recipe-notes"
          rows="3"
          :maxlength="MAX_NOTES"
          class="min-h-[88px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 py-3 text-[20px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
        ></textarea>
      </label>

      <section class="flex flex-col gap-3">
        <h3 class="text-[24px] font-semibold text-ink">Ingredients</h3>
        <div v-for="(row, i) in ingredients" :key="row.key" class="flex items-end gap-2">
          <RInput
            v-model="row.text"
            data-testid="ingredient-line"
            :label="`Ingredient ${i + 1}`"
            :maxlength="MAX_INGREDIENT_TEXT"
            class="flex-1"
          />
          <RButton
            variant="secondary"
            tier="moment"
            :aria-label="`Move ingredient ${i + 1} up`"
            :disabled="i === 0"
            @click="moveIngredient(i, -1)"
          >
            ↑
          </RButton>
          <RButton
            variant="secondary"
            tier="moment"
            :aria-label="`Move ingredient ${i + 1} down`"
            :disabled="i === ingredients.length - 1"
            @click="moveIngredient(i, 1)"
          >
            ↓
          </RButton>
          <RButton variant="ghost" tier="moment" :aria-label="`Remove ingredient ${i + 1}`" @click="removeIngredient(i)">
            ✕
          </RButton>
        </div>
        <RButton
          variant="secondary"
          tier="moment"
          class="self-start"
          data-testid="add-ingredient-line"
          :disabled="ingredients.length >= MAX_INGREDIENTS"
          @click="addIngredient"
        >
          + Add an ingredient
        </RButton>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-[24px] font-semibold text-ink">Steps</h3>
        <div v-for="(row, i) in steps" :key="row.key" class="flex items-end gap-2">
          <RInput
            v-model="row.text"
            data-testid="step-line"
            :label="`Step ${i + 1}`"
            :maxlength="MAX_STEP_TEXT"
            class="flex-1"
          />
          <RButton
            variant="secondary"
            tier="moment"
            :aria-label="`Move step ${i + 1} up`"
            :disabled="i === 0"
            @click="moveStep(i, -1)"
          >
            ↑
          </RButton>
          <RButton
            variant="secondary"
            tier="moment"
            :aria-label="`Move step ${i + 1} down`"
            :disabled="i === steps.length - 1"
            @click="moveStep(i, 1)"
          >
            ↓
          </RButton>
          <RButton variant="ghost" tier="moment" :aria-label="`Remove step ${i + 1}`" @click="removeStep(i)">
            ✕
          </RButton>
        </div>
        <RButton
          variant="secondary"
          tier="moment"
          class="self-start"
          data-testid="add-step-line"
          :disabled="steps.length >= MAX_STEPS"
          @click="addStep"
        >
          + Add a step
        </RButton>
      </section>

      <p v-if="notice" role="status" data-testid="recipe-notice" class="text-[18px] font-medium text-warn-ink">
        {{ notice }}
      </p>
      <SheetError :message="error" />
    </form>

    <template #footer>
      <RButton tier="moment" class="w-full" data-testid="recipe-save" :disabled="!canSave" @click="save">
        {{ saving ? 'Saving…' : 'Save recipe' }}
      </RButton>
    </template>
  </RSheet>
</template>
