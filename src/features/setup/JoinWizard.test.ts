import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, markRaw } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import JoinWizard from './JoinWizard.vue'
import type { WizardState } from './wizardState'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'

const claimDisplay = vi.hoisted(() => vi.fn())
const displayStore = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('@/data/supabase', () => ({ displayClient: { device: true } }))
vi.mock('@/session/displaySession', () => ({ claimDisplay }))
vi.mock('@/session/displayStore', () => ({ useDisplayStore: () => displayStore }))
vi.mock('@/session/useAdultSessionIdle', () => ({ useAdultSessionIdle: () => {} }))

interface Answer {
  data: unknown
  error: { message: string } | null
}

/** The owner's signed-in client: `from(table)` answers with that table's rows, `rpc(name)` with that RPC's answer. */
function fakeAdult(tables: Record<string, Answer>, rpcs: Record<string, Answer>) {
  const rpc = vi.fn(async (name: string) => rpcs[name] ?? { data: null, error: { message: `unexpected rpc ${name}` } })
  const from = vi.fn((table: string) => {
    const answer = tables[table] ?? { data: [], error: null }
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order']) chain[method] = () => chain
    chain.then = (resolve: (a: Answer) => unknown) => Promise.resolve(answer).then(resolve)
    return chain
  })
  const end = vi.fn().mockResolvedValue(undefined)
  return { session: { client: markRaw({ from, rpc }), userId: 'user-sam', email: 'sam@roost.test', end }, rpc, from, end }
}

let adult: ReturnType<typeof fakeAdult>
let router: Router

/** Stands in for the email-code sign-in: one tap signs the owner in. */
const SignInStub = defineComponent({
  props: { state: { type: Object, required: true } },
  emits: ['next', 'back'],
  setup(props, { emit }) {
    return () =>
      h('button', {
        'data-testid': 'sign-in',
        onClick: () => {
          ;(props.state as WizardState).adult = adult.session as never
          emit('next')
        },
      })
  },
})

const NOW = new Date('2026-09-21T16:00:00Z')
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()
const MEMBERSHIPS: Answer = { data: [{ household_id: HOUSEHOLD, households: { name: 'Rivera' } }], error: null }
const KITCHEN = { id: 'display-kitchen', name: 'Kitchen', last_seen_at: minutesAgo(3 * 24 * 60), auth_user_id: 'device-old' }
const PLAYROOM = { id: 'display-playroom', name: 'Playroom', last_seen_at: minutesAgo(2), auth_user_id: 'device-play' }
const HALL = { id: 'display-hall', name: 'Hall', last_seen_at: minutesAgo(60), auth_user_id: null }

function buttonByText(w: VueWrapper, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

async function mountAtDisplays(displays: unknown[], rpcs: Record<string, Answer>): Promise<VueWrapper> {
  adult = fakeAdult({ memberships: MEMBERSHIPS, displays: { data: displays, error: null } }, rpcs)
  const Stub = defineComponent({ render: () => h('p', 'stub') })
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/join', component: Stub },
      { path: '/home', component: Stub },
      { path: '/setup', component: Stub },
    ],
  })
  await router.push('/join')
  await router.isReady()
  const w = mount(JoinWizard, { global: { plugins: [router], stubs: { SignInStep: SignInStub } }, attachTo: document.body })
  await w.find('[data-testid="sign-in"]').trigger('click')
  await flushPromises()
  await buttonByText(w, 'Rivera').trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setActivePinia(createPinia())
  claimDisplay.mockReset().mockResolvedValue({ displayId: 'display-kitchen', householdId: HOUSEHOLD, name: 'Kitchen' })
  displayStore.refresh.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('JoinWizard', () => {
  it('asks which display this is, listing the household’s displays before "Add as a new display"', async () => {
    const w = await mountAtDisplays([KITCHEN, PLAYROOM, HALL], {})

    expect(w.text()).toContain('Which display is this?')
    expect(w.find('[data-testid="reconnect-display-kitchen"]').text()).toBe('KitchenLast seen 3 days ago')
    expect(w.find('[data-testid="reconnect-display-playroom"]').text()).toBe('PlayroomLast seen 2 minutes ago')
    expect(w.find('[data-testid="reconnect-display-hall"]').text()).toBe('HallSigned out')
    expect(w.find('[data-testid="add-new-display"]').exists()).toBe(true)
    w.unmount()
  })

  it('reconnects as a display nobody has used lately: same display, claimed by this device, owner signed out', async () => {
    const w = await mountAtDisplays([KITCHEN, PLAYROOM], { reconnect_display: { data: [{ out_claim_token: 'token-1' }], error: null } })

    await w.find('[data-testid="reconnect-display-kitchen"]').trigger('click')
    await flushPromises()

    expect(adult.rpc).toHaveBeenCalledWith('reconnect_display', { p_display_id: 'display-kitchen' })
    expect(adult.rpc).not.toHaveBeenCalledWith('register_display', expect.anything())
    expect(claimDisplay).toHaveBeenCalledWith({ device: true }, 'token-1')
    expect(adult.end).toHaveBeenCalled()
    expect(displayStore.refresh).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('warns before taking a display that checked in moments ago, and does nothing until confirmed', async () => {
    const w = await mountAtDisplays([KITCHEN, PLAYROOM], { reconnect_display: { data: [{ out_claim_token: 'token-2' }], error: null } })

    await w.find('[data-testid="reconnect-display-playroom"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Reconnect as Playroom?')
    expect(w.text()).toContain('Playroom checked in 2 minutes ago, so a tablet may still be using it. Reconnecting signs that tablet out.')
    expect(adult.rpc).not.toHaveBeenCalled()

    await w.find('[data-testid="reconnect-anyway"]').trigger('click')
    await flushPromises()
    expect(adult.rpc).toHaveBeenCalledWith('reconnect_display', { p_display_id: 'display-playroom' })
    expect(claimDisplay).toHaveBeenCalledWith({ device: true }, 'token-2')
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('a refused reconnect goes back to the list with wording for people, still signed in', async () => {
    const w = await mountAtDisplays([KITCHEN], { reconnect_display: { data: null, error: { message: 'display not found' } } })

    await w.find('[data-testid="reconnect-display-kitchen"]').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Which display is this?')
    expect(w.text()).toContain('That display isn’t available any more.')
    expect(claimDisplay).not.toHaveBeenCalled()
    expect(adult.end).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/join')
    w.unmount()
  })

  it('"Add as a new display" still registers a new one', async () => {
    const w = await mountAtDisplays([KITCHEN], { register_display: { data: [{ out_display_id: 'd-new', out_claim_token: 'token-3' }], error: null } })

    await w.find('[data-testid="add-new-display"]').trigger('click')
    await w.find('input').setValue('Nursery')
    await buttonByText(w, 'Add this display').trigger('click')
    await flushPromises()

    expect(adult.rpc).toHaveBeenCalledWith('register_display', { p_household_id: HOUSEHOLD, p_name: 'Nursery' })
    expect(claimDisplay).toHaveBeenCalledWith({ device: true }, 'token-3')
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('a household with no displays goes straight to naming a new one', async () => {
    const w = await mountAtDisplays([], {})
    expect(w.text()).toContain('Name this display')
    expect(w.text()).not.toContain('Which display is this?')
    w.unmount()
  })
})
