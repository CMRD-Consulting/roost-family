import { describe, expect, it } from 'vitest'
import type { RoostClient } from './supabase'
import { RecipeError, createSupabaseRecipeApi } from './recipeApi'

type Resp = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

interface RecordedCall {
  table: string
  op: 'insert' | 'update' | 'delete'
  payload?: unknown
  eq?: [string, unknown]
}

/** Responses are keyed `<table>.<op>`; anything not listed succeeds. */
function fakeClient(responses: Record<string, Resp> = {}, opts: { throws?: boolean } = {}) {
  const calls: RecordedCall[] = []

  function result(key: string): Promise<Resp> {
    if (opts.throws) return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(responses[key] ?? { error: null, data: null, status: 204 })
  }

  function from(table: string) {
    return {
      insert(payload: unknown) {
        calls.push({ table, op: 'insert', payload })
        return result(`${table}.insert`)
      },
      update(payload: unknown) {
        const call: RecordedCall = { table, op: 'update', payload }
        calls.push(call)
        return {
          eq(col: string, val: unknown) {
            call.eq = [col, val]
            return result(`${table}.update`)
          },
        }
      },
      delete() {
        const call: RecordedCall = { table, op: 'delete' }
        calls.push(call)
        return {
          eq(col: string, val: unknown) {
            call.eq = [col, val]
            return result(`${table}.delete`)
          },
        }
      },
    }
  }

  return { client: { from } as unknown as RoostClient, calls }
}

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const RECIPE = { id: 'recipe-1', householdId: HOUSEHOLD }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function errorOf(p: Promise<unknown>): Promise<RecipeError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(RecipeError)
  return e as RecipeError
}

describe('createSupabaseRecipeApi', () => {
  it('creates a recipe with the id the device made', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).createRecipe({
      id: 'recipe-1', householdId: HOUSEHOLD, title: 'Weeknight tacos', sourceUrl: null, servings: 4, notes: null,
    })

    expect(calls).toEqual([
      {
        table: 'recipes',
        op: 'insert',
        payload: {
          id: 'recipe-1', household_id: HOUSEHOLD, title: 'Weeknight tacos', source_url: null, servings: 4, notes: null,
        },
      },
    ])
  })

  it('updates the editable fields of one recipe', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).updateRecipe('recipe-1', {
      title: 'Tacos', sourceUrl: 'https://example.com/tacos', servings: null, notes: 'Double it.',
    })

    expect(calls).toEqual([
      {
        table: 'recipes',
        op: 'update',
        payload: { title: 'Tacos', source_url: 'https://example.com/tacos', servings: null, notes: 'Double it.' },
        eq: ['id', 'recipe-1'],
      },
    ])
  })

  it('archives rather than deletes, stamping archived_at with the current time', async () => {
    const before = Date.now()
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).archiveRecipe('recipe-1')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'recipes', op: 'update', eq: ['id', 'recipe-1'] })
    const { archived_at: archivedAt } = calls[0]!.payload as { archived_at: string }
    expect(Date.parse(archivedAt)).toBeGreaterThanOrEqual(before)
  })

  it('replaces the whole ingredient set, numbering the lines from 0', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).setIngredients(RECIPE, ['Ground beef', 'Taco shells'])

    expect(calls[0]).toEqual({ table: 'recipe_ingredients', op: 'delete', eq: ['recipe_id', 'recipe-1'] })
    expect(calls[1]?.table).toBe('recipe_ingredients')
    expect(calls[1]?.op).toBe('insert')
    expect(calls[1]?.payload).toEqual([
      { id: expect.stringMatching(UUID), household_id: HOUSEHOLD, recipe_id: 'recipe-1', text: 'Ground beef', sort: 0 },
      { id: expect.stringMatching(UUID), household_id: HOUSEHOLD, recipe_id: 'recipe-1', text: 'Taco shells', sort: 1 },
    ])
  })

  it('replaces the whole step set the same way', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).setSteps(RECIPE, ['Brown the beef.'])

    expect(calls.map((c) => [c.table, c.op])).toEqual([
      ['recipe_steps', 'delete'],
      ['recipe_steps', 'insert'],
    ])
    expect(calls[1]?.payload).toEqual([
      { id: expect.stringMatching(UUID), household_id: HOUSEHOLD, recipe_id: 'recipe-1', text: 'Brown the beef.', sort: 0 },
    ])
  })

  it('clearing every line deletes without an empty insert', async () => {
    const { client, calls } = fakeClient()
    await createSupabaseRecipeApi(client).setIngredients(RECIPE, [])

    expect(calls).toEqual([{ table: 'recipe_ingredients', op: 'delete', eq: ['recipe_id', 'recipe-1'] }])
  })

  it('maps an RLS refusal (42501) to denied', async () => {
    const { client } = fakeClient({ 'recipes.insert': { error: { message: 'permission denied', code: '42501' }, status: 403 } })
    const e = await errorOf(
      createSupabaseRecipeApi(client).createRecipe({
        id: 'recipe-1', householdId: HOUSEHOLD, title: 'Tacos', sourceUrl: null, servings: null, notes: null,
      }),
    )
    expect(e.code).toBe('denied')
    expect(e.message).toBe('permission denied')
  })

  it.each([
    ['22023', 'a limit raised by a trigger'],
    ['23514', 'a check constraint'],
    ['22001', 'text longer than the column'],
  ])('maps %s (%s) to invalid', async (code) => {
    const { client } = fakeClient({ 'recipes.update': { error: { message: 'no', code }, status: 400 } })
    const e = await errorOf(
      createSupabaseRecipeApi(client).updateRecipe('recipe-1', { title: '', sourceUrl: null, servings: null, notes: null }),
    )
    expect(e.code).toBe('invalid')
  })

  it('maps a thrown fetch, a timeout and a server error to network', async () => {
    const thrown = fakeClient({}, { throws: true })
    expect((await errorOf(createSupabaseRecipeApi(thrown.client).archiveRecipe('recipe-1'))).code).toBe('network')

    const aborted = fakeClient({ 'recipes.update': { error: { message: 'AbortError: Request timed out', code: '' }, status: 0 } })
    expect((await errorOf(createSupabaseRecipeApi(aborted.client).archiveRecipe('recipe-1'))).code).toBe('network')

    const gateway = fakeClient({ 'recipes.update': { error: { message: 'Bad gateway' }, status: 502 } })
    expect((await errorOf(createSupabaseRecipeApi(gateway.client).archiveRecipe('recipe-1'))).code).toBe('network')
  })

  it('maps anything else to other', async () => {
    const { client } = fakeClient({ 'recipe_steps.delete': { error: { message: 'huh', code: 'PGRST116' }, status: 406 } })
    expect((await errorOf(createSupabaseRecipeApi(client).setSteps(RECIPE, ['x']))).code).toBe('other')
  })
})
