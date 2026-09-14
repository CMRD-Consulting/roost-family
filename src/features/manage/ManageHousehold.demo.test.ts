import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { resetDemoForTests } from '@/data/demo/demoHousehold'
import ManageHousehold from './ManageHousehold.vue'

vi.mock('@/data/householdSource', () => ({ isDemo: true }))
vi.mock('@/session/adultSession', () => {
  throw new Error('Adult sign-in loaded in demo mode')
})
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded in demo mode')
})

async function settle() {
  for (let i = 0; i < 10; i++) await flushPromises()
}

/** The demo API loads with a dynamic import: wait for the demo adults to show. */
async function demoButton(w: VueWrapper, text: string) {
  return vi.waitFor(() => buttonByText(w, text))
}

function buttonByText(w: VueWrapper, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

async function mountPage(): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/manage', component: defineComponent({ render: () => h('p') }) }] })
  await router.push('/manage')
  await router.isReady()
  const w = mount(ManageHousehold, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await settle()
  return w
}

beforeEach(() => resetDemoForTests())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('Manage household in demo mode', () => {
  it('signs in as the demo owner and lists the demo members and display', async () => {
    const w = await mountPage()
    expect(w.text()).toContain('The demo has no accounts.')
    await (await demoButton(w, 'S Sam (Owner)')).trigger('click')
    await settle()

    expect(w.find('header h1').text()).toBe('Rivera')
    expect(w.findAll('h2').map((x) => x.text())).toEqual(['Calendars', 'Displays', 'Members', 'Export', 'Delete household'])
    expect(w.text()).toContain('Calendars aren’t available in the demo.')
    expect(w.text()).toContain('Kitchen')
    expect(w.text()).toContain('Alex')
    expect(w.text()).toContain('Removing adults is not available in demo.')
    expect(w.text()).toContain('Not available in demo.')
    w.unmount()
  })

  it('signs in as the demo adult to My account', async () => {
    const w = await mountPage()
    await (await demoButton(w, 'A Alex (Adult)')).trigger('click')
    await settle()
    expect(w.findAll('h2').map((x) => x.text())).toEqual(['My account'])
    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('Not available in demo.')
    w.unmount()
  })
})
