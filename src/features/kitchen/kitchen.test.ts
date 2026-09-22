import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { getDemoSnapshot, mutateDemo, resetDemoForTests } from '@/data/demo/demoHousehold'
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

const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'

let pinia: Pinia

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

async function mountKitchen(path = '/kitchen') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/home', component: { render: () => null } },
      { path: '/kitchen', component: KitchenScreen },
      { path: '/removed', component: { render: () => null } },
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

describe('KitchenScreen (demo source)', () => {
  beforeEach(() => {
    resetDemoForTests()
    localStorage.clear()
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

  describe('the shell', () => {
    it('opens on Shopping and puts the chosen tab in the query', async () => {
      const { wrapper, router } = await mountKitchen()
      const tabs = wrapper.findAll('[role="tab"]')
      expect(tabs.map((t) => t.text())).toEqual(['Shopping', 'To-do', 'Meals', 'Recipes'])
      expect(tabs[0]!.attributes('aria-selected')).toBe('true')

      await buttonWith(wrapper, '[role="tab"]', 'To-do').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.query.tab).toBe('todo')
      expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Add a to-do')
      wrapper.unmount()
    })

    it('comes back to the tab in the query', async () => {
      const { wrapper } = await mountKitchen('/kitchen?tab=meals')
      expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
      // The Meals panel itself is covered by kitchenRecipes.test.ts; here it only has to be the one showing.
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Not planned')
      wrapper.unmount()
    })

    it('leaves for the main screen with no PIN', async () => {
      const { wrapper, router } = await mountKitchen()
      await wrapper.get('[data-testid="kitchen-done"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/home')
      wrapper.unmount()
    })
  })

  describe('the Shopping tab', () => {
    it('shows a chip per list with its open count, and the default list first', async () => {
      const { wrapper } = await mountKitchen()
      const chips = wrapper.findAll('[data-testid="list-chip"]')
      expect(chips.map((c) => c.text())).toEqual(['Groceries1', 'Costco1'])
      expect(chips[0]!.attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Whole milk')
      expect(wrapper.get('[role="tabpanel"]').text()).not.toContain('Bananas')
      wrapper.unmount()
    })

    it('adds an item to the list that is selected, not the default one', async () => {
      const { wrapper } = await mountKitchen()
      await buttonWith(wrapper, '[data-testid="list-chip"]', 'Costco').trigger('click')
      await flushPromises()
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Bananas')

      await type(wrapper, 'shopping-add', 'Paper towels')
      await wrapper.get('form').trigger('submit')
      await settle()

      const added = snapshot().groceries.find((g) => g.text === 'Paper towels')
      expect(added).toMatchObject({ listId: 'list-costco', checkedAt: null })
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Paper towels')
      wrapper.unmount()
    })

    it('checks an item off, striking it through and dropping the chip count', async () => {
      const { wrapper } = await mountKitchen()
      const row = buttonWith(wrapper, '[data-testid="shopping-item"]', 'Whole milk')
      await row.get('[role="checkbox"]').trigger('click')
      await settle()

      expect(snapshot().groceries.find((g) => g.id === 'grocery-1')?.checkedAt).not.toBeNull()
      expect(wrapper.get('[data-testid="shopping-item"] [role="checkbox"]').attributes('aria-checked')).toBe('true')
      expect(buttonWith(wrapper, '[data-testid="list-chip"]', 'Groceries').text()).toBe('Groceries0')
      wrapper.unmount()
    })

    it('creates a list, selects it, and renames it', async () => {
      const { wrapper } = await mountKitchen()
      await buttonLabelled(wrapper, '+ New list').trigger('click')
      await flushPromises()
      await type(wrapper, 'list-name', 'Hardware')
      await buttonLabelled(wrapper, 'Save').trigger('click')
      await settle()

      const created = (snapshot().shoppingLists ?? []).find((l) => l.name === 'Hardware')
      expect(created).toBeDefined()
      expect(buttonWith(wrapper, '[data-testid="list-chip"]', 'Hardware').attributes('aria-pressed')).toBe('true')

      await buttonLabelled(wrapper, 'Rename').trigger('click')
      await flushPromises()
      await type(wrapper, 'list-name', 'Hardware store')
      await buttonLabelled(wrapper, 'Save').trigger('click')
      await settle()

      expect((snapshot().shoppingLists ?? []).find((l) => l.id === created!.id)?.name).toBe('Hardware store')
      wrapper.unmount()
    })

    it('archives a list on a second tap, and never the last one', async () => {
      const { wrapper } = await mountKitchen()
      const archive = wrapper.get('[data-testid="archive-list"]')
      expect(archive.attributes('disabled')).toBeUndefined()
      await archive.trigger('click')
      expect(wrapper.get('[data-testid="archive-list"]').text()).toBe('Archive — tap again')
      await wrapper.get('[data-testid="archive-list"]').trigger('click')
      await settle()

      expect((snapshot().shoppingLists ?? []).find((l) => l.id === 'list-groceries')?.archivedAt).not.toBeNull()
      expect(wrapper.findAll('[data-testid="list-chip"]')).toHaveLength(1)
      // One list left: archiving is refused and the rule is shown inline, never as a dialog.
      expect(wrapper.get('[data-testid="archive-list"]').attributes('disabled')).toBeDefined()
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('A household keeps at least one list.')
      wrapper.unmount()
    })

    it('says so when a list is empty', async () => {
      mutateDemo((s) => ({ ...s, groceries: [] }))
      const { wrapper } = await mountKitchen()
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Nothing on this list yet.')
      wrapper.unmount()
    })
  })

  describe('the To-do tab', () => {
    const openTodo = () => mountKitchen('/kitchen?tab=todo')

    it('groups rows by when they are due, with the last day of completions at the bottom', async () => {
      const { wrapper } = await openTodo()
      const groups = wrapper.findAll('[data-testid="todo-group"]')
      expect(groups.map((g) => g.get('h3').text())).toEqual(['Overdue', 'Today', 'No date', 'Done'])
      expect(groups[0]!.text()).toContain("Refill Theo's prescription")
      expect(groups[0]!.text()).toContain('Yesterday')
      expect(groups[1]!.text()).toContain("Sign Ivy's field trip form")
      expect(groups[3]!.text()).toContain('Take out the recycling')
      wrapper.unmount()
    })

    it('filters by person and gives a new to-do that filter\'s assignee', async () => {
      const { wrapper } = await openTodo()
      // An adult's chip carries their RAvatar, so its initial is in the text too (colour is never alone).
      expect(wrapper.findAll('[data-testid="todo-filter"]').map((c) => c.text())).toEqual([
        'All3', 'Family1', 'SSam1', 'AAlex1',
      ])

      await buttonWith(wrapper, '[data-testid="todo-filter"]', 'Alex').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('[data-testid="todo-item"]')).toHaveLength(1)

      await type(wrapper, 'todo-add', 'Pick up the dry cleaning')
      await wrapper.get('form').trigger('submit')
      await settle()

      const added = (snapshot().tasks ?? []).find((t) => t.text === 'Pick up the dry cleaning')
      expect(added).toMatchObject({ assignedMembershipId: ALEX, dueOn: null, doneAt: null })
      expect(wrapper.findAll('[data-testid="todo-item"]')).toHaveLength(2)
      wrapper.unmount()
    })

    it('completes a to-do, striking it through and dropping the open count', async () => {
      const { wrapper } = await openTodo()
      const row = buttonWith(wrapper, '[data-testid="todo-item"]', "Refill Theo's prescription")
      await row.get('[role="checkbox"]').trigger('click')
      await settle()

      expect((snapshot().tasks ?? []).find((t) => t.id === 'task-prescription')?.doneAt).not.toBeNull()
      expect(buttonWith(wrapper, '[data-testid="todo-filter"]', 'All').text()).toBe('All2')
      expect(wrapper.findAll('[data-testid="todo-group"]').map((g) => g.get('h3').text())).toEqual([
        'Today', 'No date', 'Done',
      ])
      wrapper.unmount()
    })

    it('edits a to-do in the sheet: text, assignee and due date', async () => {
      const { wrapper } = await openTodo()
      await wrapper.get(`button[aria-label="Edit Refill Theo's prescription"]`).trigger('click')
      await flushPromises()

      const sheet = wrapper.get('[role="dialog"]')
      expect(sheet.text()).toContain('Edit to-do')
      await type(wrapper, 'task-text', 'Refill the prescription')
      await buttonWith(wrapper, '[role="radiogroup"][aria-label="Due"] [role="radio"]', 'Tomorrow').trigger('click')
      await buttonLabelled(wrapper, 'Save').trigger('click')
      await settle()

      expect((snapshot().tasks ?? []).find((t) => t.id === 'task-prescription')).toMatchObject({
        text: 'Refill the prescription',
        dueOn: '2026-09-15',
      })
      wrapper.unmount()
    })

    it('says so when there is nothing to do', async () => {
      mutateDemo((s) => ({ ...s, tasks: [] }))
      const { wrapper } = await openTodo()
      expect(wrapper.get('[role="tabpanel"]').text()).toContain('Nothing to do.')
      wrapper.unmount()
    })
  })
})
