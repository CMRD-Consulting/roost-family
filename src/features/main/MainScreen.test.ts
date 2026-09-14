import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { resetDemoForTests } from '@/data/demo/demoHousehold'
import MainScreen from './MainScreen.vue'

vi.mock('@/data/householdSource', async () => {
  const { demoSource } = await import('@/data/demo/demoSource')
  return {
    isDemo: true,
    DEMO_DISPLAY: { displayId: 'demo-display', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' },
    selectSource: async () => demoSource,
  }
})
// MainScreen must not touch Supabase in demo mode; fail loudly if it does.
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

async function mountMain() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/home', component: MainScreen },
      { path: '/removed', component: { render: () => null } },
    ],
  })
  await router.push('/home')
  await router.isReady()
  const wrapper = mount(MainScreen, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('MainScreen (demo source)', () => {
  beforeEach(() => {
    // The demo household is a lazily-built singleton keyed off the URL at first access;
    // reset it so each test's own ?manyKids/?conflict params (set after this hook runs) take effect.
    resetDemoForTests()
    // Leave setImmediate real so flushPromises can resolve.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.useRealTimers()
  })

  it('renders the clock, kid cards, medicine, dinner and log row', async () => {
    const wrapper = await mountMain()
    const text = wrapper.text()
    for (const expected of ['3:00 PM', 'Monday', 'September 14', 'Ivy', 'Theo', 'Awake 2h 40m', 'Infant ibuprofen', 'Next after 7:00 PM', 'Tacos']) {
      expect(text).toContain(expected)
    }
    expect(wrapper.findAll('[data-testid="kid-card"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-log-kind]')).toHaveLength(6)
    expect(wrapper.find('[data-testid="conflict"]').exists()).toBe(false)
    expect(text).not.toContain('Offline')
    wrapper.unmount()
  })

  it('switches to compact cards with many kids', async () => {
    window.history.replaceState({}, '', '/home?manyKids')
    const wrapper = await mountMain()
    expect(wrapper.findAll('[data-testid="kid-card-compact"]')).toHaveLength(6)
    expect(wrapper.findAll('[data-testid="kid-card"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('shows the dose conflict banner', async () => {
    window.history.replaceState({}, '', '/home?conflict')
    const wrapper = await mountMain()
    expect(wrapper.findAll('[data-testid="conflict"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Acknowledge')
    wrapper.unmount()
  })

  it('renders the conflict banner and medicine zone before kid cards when compact with a conflict', async () => {
    window.history.replaceState({}, '', '/home?conflict&manyKids')
    const wrapper = await mountMain()
    const html = wrapper.html()
    const conflictIndex = html.indexOf('data-testid="conflict"')
    const medicineIndex = html.indexOf('data-testid="medicine-line"')
    const firstKidCardIndex = html.indexOf('data-testid="kid-card-compact"')
    expect(conflictIndex).toBeGreaterThan(-1)
    expect(medicineIndex).toBeGreaterThan(-1)
    expect(firstKidCardIndex).toBeGreaterThan(-1)
    expect(conflictIndex).toBeLessThan(firstKidCardIndex)
    expect(medicineIndex).toBeLessThan(firstKidCardIndex)
    wrapper.unmount()
  })

  it('shows a placeholder toast after a log button is held', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = await mountMain()
    const button = wrapper.get('[data-log-kind="sleep"]')
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    Object.defineProperties(down, { pointerId: { value: 1 }, pointerType: { value: 'touch' } })
    button.element.dispatchEvent(down)
    vi.advanceTimersByTime(600)
    await flushPromises()
    expect(wrapper.text()).toContain('Logging arrives in Phase 2b')
    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Logging arrives in Phase 2b')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
