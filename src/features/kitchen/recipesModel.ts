/**
 * Recipes tab (kitchen spec §5.2): the recipe cards newest-first, the title search that appears once the box
 * is big enough to need it, and the per-recipe limits (§2, §8). Pure — no Vue, no stores.
 */
import type { RecipeErrorCode } from '@/data/recipeApi'
import type { Recipe, RecipeLine } from '@/data/snapshot'

export const MAX_RECIPES = 300
export const MAX_INGREDIENTS = 50
export const MAX_STEPS = 40
/** Field lengths, matching the `recipes` check constraints (kitchen spec §6). */
export const MAX_TITLE = 80
export const MAX_SOURCE_URL = 500
export const MAX_NOTES = 2000
export const MAX_INGREDIENT_TEXT = 100
export const MAX_STEP_TEXT = 500

/** Below this many recipes the grid is scannable on its own, so the search field stays out of the way (§5.2). */
export const SEARCH_THRESHOLD = 12

// Limits are shown inline, never as a blocking dialog (kitchen spec §8).
export const RECIPE_LIMIT_MESSAGE = '300 recipes is the maximum.'
export const INGREDIENT_LIMIT_MESSAGE = 'A recipe holds 50 ingredients.'
export const STEP_LIMIT_MESSAGE = 'A recipe holds 40 steps.'
export const EMPTY_RECIPES_MESSAGE = 'No recipes yet — add the first one.'
export const NO_MATCH_MESSAGE = 'No recipe by that name.'
/** Recipe authoring is online only (kitchen spec §5.2, §8). */
export const OFFLINE_MESSAGE = 'Recipes need a connection.'

/** What a card shows (kitchen spec §5.2). */
export interface RecipeCard {
  id: string
  title: string
  ingredientCount: number
  servings: number | null
}

export interface RecipesModel {
  cards: RecipeCard[]
  /** Recipes in the box, before the search narrows them — what the 300 limit counts. */
  total: number
  /** The search field shows once there are more than 12 recipes (kitchen spec §5.2). */
  showSearch: boolean
  canAddRecipe: boolean
}

/** Un-archived recipes, newest first (`createdAt`, then `id` so the order is stable). */
export function visibleRecipes(recipes: Recipe[] | undefined): Recipe[] {
  return (recipes ?? [])
    .filter((recipe) => recipe.archivedAt === null)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
}

/** The search matches the title only — ingredients are not searched (kitchen spec §5.2). */
export function matches(recipe: Recipe, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 || recipe.title.toLowerCase().includes(needle)
}

export function buildRecipesModel(recipes: Recipe[] | undefined, query: string): RecipesModel {
  const all = visibleRecipes(recipes)
  return {
    cards: all.filter((recipe) => matches(recipe, query)).map(toCard),
    total: all.length,
    showSearch: all.length > SEARCH_THRESHOLD,
    canAddRecipe: all.length < MAX_RECIPES,
  }
}

export function toCard(recipe: Recipe): RecipeCard {
  return {
    id: recipe.id,
    title: recipe.title,
    ingredientCount: recipe.ingredients.length,
    servings: recipe.servings,
  }
}

/** "5 ingredients", or "1 ingredient". */
export function ingredientsLabel(count: number): string {
  return `${count} ${count === 1 ? 'ingredient' : 'ingredients'}`
}

/** "Serves 4", or null when the recipe doesn't say. */
export function servingsLabel(servings: number | null): string | null {
  return servings === null ? null : `Serves ${servings}`
}

/** A recipe's lines in their saved order, as plain text — what the editor and the ingredients sheet work from. */
export function lineTexts(lines: RecipeLine[]): string[] {
  return lines
    .slice()
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((line) => line.text)
}

/** A title, ingredient or step as it is saved: trimmed, collapsed and capped. Empty means "don't save". */
export function cleanLine(text: string, max: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, max)
}

/** Notes keep their line breaks; only the ends are trimmed. */
export function cleanNotes(text: string): string | null {
  const clean = text.trim().slice(0, MAX_NOTES)
  return clean.length === 0 ? null : clean
}

/** Servings as the editor's number field gives it: 1–99, or null for "not set". */
export function cleanServings(value: string): number | null {
  const n = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(n, 99)
}

/** The limit a recipe is already at, if any — shown inline before a save is even attempted (kitchen spec §8). */
export function limitNotice(ingredientCount: number, stepCount: number): string | null {
  if (ingredientCount >= MAX_INGREDIENTS) return INGREDIENT_LIMIT_MESSAGE
  if (stepCount >= MAX_STEPS) return STEP_LIMIT_MESSAGE
  return null
}

/** A recipe's ingredients and steps as the server will take them: capped in length and in count. */
export function trimLines(lines: string[], max: number, maxLength: number): string[] {
  return lines
    .map((line) => cleanLine(line, maxLength))
    .filter((line) => line.length > 0)
    .slice(0, max)
}

/**
 * What a failed write says, by code — never the server's own message (kitchen spec §7.2). `invalid` names the
 * limits, because that is the only way a capped field is refused.
 */
export function recipeErrorMessage(code: RecipeErrorCode): string {
  switch (code) {
    case 'denied':
      return "You can't change this recipe."
    case 'invalid':
      return 'A recipe holds 50 ingredients and 40 steps, with a title of 80 characters or fewer.'
    case 'network':
      return 'No connection — try again.'
    default:
      return 'Something went wrong.'
  }
}

/** Moves the line at `index` one place up (`-1`) or down (`1`). Out-of-range moves leave the order alone. */
export function moveLine<T>(lines: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= lines.length || target < 0 || target >= lines.length) return lines.slice()
  const next = lines.slice()
  const a = next[index]!
  const b = next[target]!
  next[index] = b
  next[target] = a
  return next
}
