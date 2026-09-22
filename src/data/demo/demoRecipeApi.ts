/** Demo-mode recipe box (spec §7.2): writes straight into the shared in-memory demo household. */
import { newId } from '../logCommands'
import type { RecipeApi, RecipeRef } from '../recipeApi'
import type { Recipe, RecipeLine } from '../snapshot'
import { mutateDemo } from './demoHousehold'

/** Simulated network latency, so the editor's saving state has something to show. */
const DELAY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lines(texts: string[]): RecipeLine[] {
  return texts.map((text, sort) => ({ id: newId(), text, sort }))
}

function updateRecipeById(id: string, fn: (recipe: Recipe) => Recipe): void {
  mutateDemo((s) => ({ ...s, recipes: (s.recipes ?? []).map((r) => (r.id === id ? fn(r) : r)) }))
}

export function createDemoRecipeApi(): RecipeApi {
  return {
    async createRecipe(input) {
      await delay(DELAY_MS)
      const recipe: Recipe = {
        id: input.id,
        title: input.title,
        sourceUrl: input.sourceUrl,
        servings: input.servings,
        notes: input.notes,
        createdAt: new Date().toISOString(),
        archivedAt: null,
        ingredients: [],
        steps: [],
      }
      mutateDemo((s) => ({ ...s, recipes: [...(s.recipes ?? []), recipe] }))
    },
    async updateRecipe(id, input) {
      await delay(DELAY_MS)
      updateRecipeById(id, (r) => ({ ...r, title: input.title, sourceUrl: input.sourceUrl, servings: input.servings, notes: input.notes }))
    },
    async archiveRecipe(id) {
      await delay(DELAY_MS)
      // Archived recipes are not loaded, so the demo drops them from the snapshot instead of keeping a hidden row.
      mutateDemo((s) => ({ ...s, recipes: (s.recipes ?? []).filter((r) => r.id !== id) }))
    },
    async setIngredients(recipe: RecipeRef, texts) {
      await delay(DELAY_MS)
      updateRecipeById(recipe.id, (r) => ({ ...r, ingredients: lines(texts) }))
    },
    async setSteps(recipe: RecipeRef, texts) {
      await delay(DELAY_MS)
      updateRecipeById(recipe.id, (r) => ({ ...r, steps: lines(texts) }))
    },
  }
}
