/**
 * Recipe authoring (spec §5.1, §7.2): the only part of the Kitchen that needs a connection. Reads come from the
 * snapshot; only writes go through here, straight to the tables — recipes are member-writable, so RLS
 * (`private.is_household_member`) is the whole check and there are no RPCs.
 *
 * Shaped like `takeListApi.ts`: a `RecipeError` with a small code union, an interface, a Supabase
 * implementation, a demo one, and a lazy `loadRecipeApi()`.
 */
import { isDemo } from './householdSource'
import { newId } from './logCommands'
import type { RoostClient } from './supabase'

export type RecipeErrorCode = 'denied' | 'invalid' | 'network' | 'other'

/** `denied`: the caller isn't a member of the household (or the session lapsed). `invalid`: the server refused the
 *  input, e.g. a title that is too long or one recipe too many. `network`: no response, a timeout, or a
 *  server/gateway failure — the editor asks for a connection rather than queueing. */
export class RecipeError extends Error {
  constructor(
    message: string,
    readonly code: RecipeErrorCode,
  ) {
    super(message)
    this.name = 'RecipeError'
  }
}

/** The editable fields of a recipe (spec §5.1). */
export interface RecipeInput {
  title: string
  sourceUrl: string | null
  servings: number | null
  notes: string | null
}

/** A new recipe: its id is made on the device, so its ingredients and steps can be written straight after. */
export interface NewRecipe extends RecipeInput {
  id: string
  householdId: string
}

/** Which recipe a set of lines belongs to. The household is needed because every row carries its own. */
export interface RecipeRef {
  id: string
  householdId: string
}

export interface RecipeApi {
  createRecipe(input: NewRecipe): Promise<void>
  updateRecipe(id: string, input: RecipeInput): Promise<void>
  /** Recipes archive, they never delete, so a meal plan that names one keeps working (spec §8). */
  archiveRecipe(id: string): Promise<void>
  /** Replaces every ingredient with `lines`, in order. */
  setIngredients(recipe: RecipeRef, lines: string[]): Promise<void>
  /** Replaces every step with `lines`, in order. */
  setSteps(recipe: RecipeRef, lines: string[]): Promise<void>
}

type RecipeResult = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

function classify(status: number | null, code: string | null): RecipeErrorCode {
  if (code === '42501') return 'denied'
  if (code === '22023' || code === '23514' || code === '22001') return 'invalid'
  if (status === null && code === null) return 'network'
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return 'network'
  if (code?.startsWith('PGRST3')) return 'network'
  return 'other'
}

async function run(op: () => PromiseLike<RecipeResult>): Promise<void> {
  let result: RecipeResult
  try {
    result = await op()
  } catch (e) {
    throw new RecipeError(e instanceof Error ? e.message : String(e), 'network')
  }
  if (result.error) {
    throw new RecipeError(result.error.message, classify(result.status || null, result.error.code || null))
  }
}

function lineRows(recipe: RecipeRef, lines: string[]) {
  return lines.map((text, sort) => ({ id: newId(), household_id: recipe.householdId, recipe_id: recipe.id, text, sort }))
}

export function createSupabaseRecipeApi(client: RoostClient): RecipeApi {
  /** A whole set of lines is replaced at once — delete, then insert in order — so `sort` needs no reconciling. */
  async function setLines(table: 'recipe_ingredients' | 'recipe_steps', recipe: RecipeRef, lines: string[]): Promise<void> {
    await run(() => client.from(table).delete().eq('recipe_id', recipe.id))
    if (lines.length === 0) return
    await run(() => client.from(table).insert(lineRows(recipe, lines)))
  }

  return {
    async createRecipe(input) {
      await run(() =>
        client.from('recipes').insert({
          id: input.id,
          household_id: input.householdId,
          title: input.title,
          source_url: input.sourceUrl,
          servings: input.servings,
          notes: input.notes,
        }),
      )
    },
    async updateRecipe(id, input) {
      await run(() =>
        client
          .from('recipes')
          .update({ title: input.title, source_url: input.sourceUrl, servings: input.servings, notes: input.notes })
          .eq('id', id),
      )
    },
    async archiveRecipe(id) {
      await run(() => client.from('recipes').update({ archived_at: new Date().toISOString() }).eq('id', id))
    },
    setIngredients(recipe, lines) {
      return setLines('recipe_ingredients', recipe, lines)
    },
    setSteps(recipe, lines) {
      return setLines('recipe_steps', recipe, lines)
    },
  }
}

/** The recipe box, on the display's own client (loaded lazily so the Supabase client isn't built in tests). */
export async function loadRecipeApi(): Promise<RecipeApi> {
  if (isDemo) return (await import('./demo/demoRecipeApi')).createDemoRecipeApi()
  const { displayClient } = await import('./supabase')
  return createSupabaseRecipeApi(displayClient)
}
