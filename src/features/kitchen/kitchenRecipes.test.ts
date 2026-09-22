import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { getDemoSnapshot, resetDemoForTests } from '@/data/demo/demoHousehold'
import type { RecipeApi } from '@/data/recipeApi'
import KitchenScreen from './KitchenScreen.vue'

vi.mock('@/data/householdSource', async () => {
  const { demoSource } = await import('@/data/demo/demoSource')
  return {
    isDemo: true,
    DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' },
    selectSource: async () => demoSource,
    selectWriter: async () => (await import('@/data/demo/demoLogWriter')).createDemoLogWriter(),
    selectSettingsApi: async () => (await import('@/data/demo/demoSettingsApi')).createDemoSettingsApi(),
  }
})
// The Kitchen screen must not touch Supabase in demo mode; fail loudly if it does.
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})
// Recipe authoring is the one part of the Kitchen that talks to a server, so the box itself is faked.
const recipeApi = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/data/recipeApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/recipeApi')>()),
  loadRecipeApi: async () => recipeApi.current,
}))

type Fake = Record<keyof RecipeApi, ReturnType<typeof vi.fn>>

let pinia: Pinia
let api: Fake

/** Lets the demo writer's simulated latency pass. */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
  await flushPromises()
}

const snapshot = () => getDemoSnapshot(new Date())

const buttonWith = (w: VueWrapper, selector: string, text: string) => {
  const found = w.findAll(selector).find((b) => b.text().includes(text))
  if (!found) throw new Error(`No "${text}" matching ${selector}`)
  return found
}
const buttonLabelled = (w: VueWrapper, text: string) => buttonWith(w, 'button', text)

async function type(w: VueWrapper, testid: string, value: string) {
  await w.get(`[data-testid="${testid}"] input`).setValue(value)
}

async function mountKitchen(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/home', component: { render: () => null } },
      { path: '/kitchen', component: KitchenScreen },
    ],
  })
  await router.push(path)
  await router.isReady()
  pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(KitchenScreen, { global: { plugins: [pinia, router] }, attachTo: document.body })
  // Loading the household and opening the (fake) IndexedDB offline queue take several macrotasks.
  for (let i = 0; i < 10; i++) await flushPromises()
  return { wrapper, router }
}

describe('KitchenScreen — Meals and Recipes (demo source)', () => {
  beforeEach(() => {
    resetDemoForTests()
    localStorage.clear()
    api = {
      createRecipe: vi.fn(),
      updateRecipe: vi.fn(),
      archiveRecipe: vi.fn(),
      setIngredients: vi.fn(),
      setSteps: vi.fn(),
    }
    recipeApi.current = api
    // Leave setImmediate real so flushPromises can resolve.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(async () => {
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    const { createOfflineQueue } = await import('@/data/offlineQueue')
    await createOfflineQueue().clear()
  })

  describe('the Meals tab', () => {
    const openMeals = () => mountKitchen('/kitchen?tab=meals')

    it('shows seven days, today first and named, with what is planned', async () => {
      const { wrapper } = await openMeals()
      const days = wrapper.findAll('[data-testid="meal-day"]')
      expect(days).toHaveLength(7)
      // Today is marked by its own word, never by colour alone.
      expect(days[0]!.text()).toContain('Today')
      expect(days[0]!.text()).toContain('Sep 14')
      expect(days[0]!.text()).toContain('Tacos')
      expect(days[1]!.text()).toContain('Tuesday')
      expect(days[1]!.text()).toContain('Leftovers')
      expect(days[3]!.text()).toContain('Thursday')
      expect(days[3]!.text()).toContain('Not planned')
      wrapper.unmount()
    })

    it('plans a day from the recipe box, carrying the recipe title and its id', async () => {
      const { wrapper } = await openMeals()
      await wrapper.findAll('[data-testid="meal-day"]')[3]!.trigger('click')
      await flushPromises()
      expect(wrapper.get('[role="dialog"]').text()).toContain('Dinner — Thursday, Sep 17')

      await buttonWith(wrapper, '[data-testid="plan-recipe"]', 'Weeknight tacos').trigger('click')
      await settle()

      expect((snapshot().mealPlan ?? []).find((m) => m.day === '2026-09-17')).toMatchObject({
        text: 'Weeknight tacos',
        recipeId: 'recipe-tacos',
      })
      expect(wrapper.findAll('[data-testid="meal-day"]')[3]!.text()).toContain('Weeknight tacos')
      wrapper.unmount()
    })

    it('takes a typed-in dinner', async () => {
      const { wrapper } = await openMeals()
      await wrapper.findAll('[data-testid="meal-day"]')[4]!.trigger('click')
      await flushPromises()
      await type(wrapper, 'plan-text', 'Breakfast for dinner')
      await buttonLabelled(wrapper, 'Save').trigger('click')
      await settle()

      expect((snapshot().mealPlan ?? []).find((m) => m.day === '2026-09-18')).toMatchObject({
        text: 'Breakfast for dinner',
        recipeId: null,
      })
      wrapper.unmount()
    })

    it('clears a planned day', async () => {
      const { wrapper } = await openMeals()
      await wrapper.findAll('[data-testid="meal-day"]')[0]!.trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="plan-current"]').text()).toContain('Planned: Tacos')

      await wrapper.get('[data-testid="plan-clear"]').trigger('click')
      await settle()

      expect((snapshot().mealPlan ?? []).some((m) => m.day === '2026-09-14')).toBe(false)
      expect(wrapper.findAll('[data-testid="meal-day"]')[0]!.text()).toContain('Not planned')
      wrapper.unmount()
    })
  })

  describe('the Recipes tab', () => {
    const openRecipes = () => mountKitchen('/kitchen?tab=recipes')

    async function openRecipe(wrapper: VueWrapper, title: string) {
      await buttonWith(wrapper, '[data-testid="recipe-card"]', title).trigger('click')
      await flushPromises()
    }

    it('lists the box newest first, and opens one to read', async () => {
      const { wrapper } = await openRecipes()
      const cards = wrapper.findAll('[data-testid="recipe-card"]')
      expect(cards.map((c) => c.text().replace(/\s+/g, ' '))).toEqual([
        'Sheet-pan chicken5 ingredients · Serves 4',
        'Weeknight tacos5 ingredients · Serves 4',
      ])
      // Two recipes is well under the twelve that bring out the search field.
      expect(wrapper.find('[data-testid="recipe-search"]').exists()).toBe(false)

      await openRecipe(wrapper, 'Sheet-pan chicken')
      const panel = wrapper.get('[role="tabpanel"]')
      expect(panel.text()).toContain('Serves 4')
      expect(panel.text()).toContain('Chicken thighs')
      expect(panel.text()).toContain('Heat the oven to 425°F.')
      // The source is text on a wall tablet, never something to tap.
      expect(wrapper.get('[data-testid="recipe-source-text"]').text()).toContain('https://example.com/sheet-pan-chicken')
      expect(panel.find('a').exists()).toBe(false)
      wrapper.unmount()
    })

    it('pushes the checked ingredients onto the chosen list, one command each', async () => {
      const { wrapper } = await openRecipes()
      await openRecipe(wrapper, 'Weeknight tacos')
      await wrapper.get('[data-testid="add-ingredients-open"]').trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="add-ingredients"]').text()).toBe('Add 5 items')
      await buttonWith(wrapper, '[data-testid="ingredient-check"]', 'Shredded lettuce').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="add-ingredients"]').text()).toBe('Add 4 items')

      await buttonWith(wrapper, '[data-testid="ingredient-list-chip"]', 'Costco').trigger('click')
      await wrapper.get('[data-testid="add-ingredients"]').trigger('click')
      // One command per ingredient, submitted in order, each with the demo writer's latency.
      for (let i = 0; i < 5; i++) await settle()

      const added = snapshot().groceries.filter((g) => g.listId === 'list-costco' && g.id !== 'grocery-2')
      expect(added.map((g) => g.text)).toEqual(['Ground beef', 'Taco shells', 'Cheddar', 'Salsa'])
      expect(new Set(added.map((g) => g.id)).size).toBe(4)
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('plans the open recipe on a day of the coming week', async () => {
      const { wrapper } = await openRecipes()
      await openRecipe(wrapper, 'Weeknight tacos')
      await wrapper.get('[data-testid="plan-this"]').trigger('click')
      await flushPromises()

      await buttonWith(wrapper, '[role="radiogroup"][aria-label="Which day"] [role="radio"]', 'Friday').trigger('click')
      await wrapper.get('[data-testid="plan-recipe-confirm"]').trigger('click')
      await settle()

      expect((snapshot().mealPlan ?? []).find((m) => m.day === '2026-09-18')).toMatchObject({
        text: 'Weeknight tacos',
        recipeId: 'recipe-tacos',
      })
      wrapper.unmount()
    })

    it('archives on a second tap, never the first', async () => {
      const { wrapper } = await openRecipes()
      await openRecipe(wrapper, 'Weeknight tacos')

      await wrapper.get('[data-testid="archive-recipe"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="archive-recipe"]').text()).toBe('Archive — tap again')
      expect(api.archiveRecipe).not.toHaveBeenCalled()

      await wrapper.get('[data-testid="archive-recipe"]').trigger('click')
      await settle()
      expect(api.archiveRecipe).toHaveBeenCalledWith('recipe-tacos')
      // Back on the grid.
      expect(wrapper.findAll('[data-testid="recipe-card"]').length).toBeGreaterThan(0)
      wrapper.unmount()
    })

    it('writes a new recipe with its ingredients and steps', async () => {
      const { wrapper } = await openRecipes()
      await wrapper.get('[data-testid="new-recipe"]').trigger('click')
      await flushPromises()

      await type(wrapper, 'recipe-title', 'Tomato soup')
      await type(wrapper, 'recipe-servings', '2')
      await wrapper.findAll('[data-testid="ingredient-line"] input')[0]!.setValue('Tomatoes')
      await wrapper.get('[data-testid="add-ingredient-line"]').trigger('click')
      await flushPromises()
      await wrapper.findAll('[data-testid="ingredient-line"] input')[1]!.setValue('Cream')
      await wrapper.findAll('[data-testid="step-line"] input')[0]!.setValue('Simmer, then blend.')
      await wrapper.get('[data-testid="recipe-save"]').trigger('click')
      await settle()

      expect(api.createRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Tomato soup', servings: 2, sourceUrl: null, notes: null }),
      )
      const created = api.createRecipe.mock.calls[0]![0] as { id: string }
      expect(api.setIngredients).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }), ['Tomatoes', 'Cream'])
      expect(api.setSteps).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }), ['Simmer, then blend.'])
      wrapper.unmount()
    })

    it('says so, by code, when a write is refused', async () => {
      const { RecipeError } = await import('@/data/recipeApi')
      api.updateRecipe.mockRejectedValue(new RecipeError('new row violates row-level security policy', 'denied'))
      const { wrapper } = await openRecipes()
      await openRecipe(wrapper, 'Weeknight tacos')
      await wrapper.get('[data-testid="edit-recipe"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="recipe-save"]').trigger('click')
      await settle()

      const dialog = wrapper.get('[role="dialog"]')
      expect(dialog.text()).toContain("You can't change this recipe.")
      expect(dialog.text()).not.toContain('row-level security')
      wrapper.unmount()
    })
  })
})
