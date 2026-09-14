import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { computed, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import JoinAdultFlow from './JoinAdultFlow.vue'
import { setPendingInvite, takePendingInvite } from './pendingInvite'
import { resetSettingsApiLoaderForTests } from './settingsApiLoader'

const api = vi.hoisted(() => ({ current: null as unknown }))
const adult = vi.hoisted(() => {
  let n = 0
  return {
    newAdultClient: vi.fn(() => ({ name: `client-${++n}` })),
    sendEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    disposeAdultClient: vi.fn(),
    resetClients: () => (n = 0),
  }
})

vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/session/adultSession', () => adult)
vi.mock('@/features/main/useHouseholdSession', () => ({ useHouseholdSession: () => ({ unreachable: computed(() => false) }) }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})

type Fake = SettingsApi & Record<'recordConsent' | 'acceptMemberInvite' | 'revokeMemberInvite', ReturnType<typeof vi.fn>>

function fakeApi(): Fake {
  return {
    recordConsent: vi.fn().mockResolvedValue(undefined),
    acceptMemberInvite: vi.fn().mockResolvedValue('membership-pat'),
    revokeMemberInvite: vi.fn().mockResolvedValue(undefined),
  } as never
}

let settingsApi: Fake
let pinia: Pinia
let router: Router
const ended: string[] = []

async function settle() {
  await vi.advanceTimersByTimeAsync(50)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function buttonByText(w: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

function inputByLabel(w: VueWrapper, label: string) {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No label "${label}"`)
  return w.find(`#${CSS.escape(lab.attributes('for')!)}`)
}

const Stub = (text: string) => defineComponent({ render: () => h('p', text) })
const App = defineComponent({ render: () => h(RouterView) })

async function mountFlow(): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: Stub('main screen') },
      { path: '/join-adult', component: JoinAdultFlow },
    ],
  })
  await router.push('/join-adult')
  await router.isReady()
  const w = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await settle()
  return w
}

async function signIn(w: VueWrapper, email = 'pat@example.com') {
  await inputByLabel(w, 'Email').setValue(email)
  await buttonByText(w, 'Email me a 6-digit code').trigger('click')
  await settle()
  await inputByLabel(w, '6-digit code').setValue('123456')
  await buttonByText(w, 'Sign in').trigger('click')
  await settle()
}

async function consent(w: VueWrapper) {
  for (const box of w.findAll('input[type="checkbox"]')) await box.setValue(true)
  await buttonByText(w, 'Agree and continue').trigger('click')
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  pinia = createPinia()
  setActivePinia(pinia)
  useHouseholdStore().snapshot = buildDemoSnapshot(new Date())
  settingsApi = fakeApi()
  api.current = settingsApi
  ended.length = 0
  adult.resetClients()
  adult.sendEmailCode.mockReset().mockResolvedValue(undefined)
  adult.disposeAdultClient.mockReset().mockResolvedValue(undefined)
  adult.verifyEmailCode.mockReset().mockImplementation(async (client: { name: string }, email: string) => ({
    client, userId: `user-${email}`, email, end: vi.fn(async () => void ended.push(client.name)),
  }))
  setPendingInvite({ token: 'invite-token', role: 'adult' })
})

afterEach(() => {
  document.body.innerHTML = ''
  takePendingInvite()
  resetSettingsApiLoaderForTests()
  vi.useRealTimers()
})

describe('JoinAdultFlow', () => {
  it('is a full-screen flow with no Settings navigation, and takes the invite so it cannot be reused', async () => {
    const w = await mountFlow()
    expect(w.find('h1').text()).toBe('Hand the tablet to the new adult')
    expect(w.text()).toContain('join Rivera as an adult')
    expect(w.find('nav').exists()).toBe(false)
    expect(takePendingInvite()).toBeNull()
    expect(useSettingsSessionStore().info).toBeNull()
    w.unmount()
  })

  it('moves focus to each step’s heading', async () => {
    const w = await mountFlow()
    const focusedHeading = () => (document.activeElement?.matches('h1[tabindex="-1"]') ? document.activeElement.textContent : null)
    expect(focusedHeading()).toBe('Hand the tablet to the new adult')

    await buttonByText(w, 'I’m the new adult').trigger('click')
    await settle()
    expect(focusedHeading()).toBe('Sign in to join Rivera')

    await signIn(w)
    expect(focusedHeading()).toBe('Your family’s information')

    await consent(w)
    expect(focusedHeading()).toBe('About you')
    w.unmount()
  })

  it('without a pending invite, goes back to the main screen', async () => {
    takePendingInvite()
    const w = await mountFlow()
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('the new adult signs in, consents and joins, then is signed out and the tablet returns home', async () => {
    const w = await mountFlow()
    await buttonByText(w, 'I’m the new adult').trigger('click')
    await settle()
    expect(w.text()).toContain('Sign in to join Rivera')
    await signIn(w)

    expect(buttonByText(w, 'Agree and continue').attributes('disabled')).toBeDefined()
    const boxes = w.findAll('input[type="checkbox"]')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    await buttonByText(w, 'Agree and continue').trigger('click')
    await settle()
    expect(settingsApi.recordConsent).toHaveBeenCalledWith({ name: 'client-1' }, '2026-09-14')

    await inputByLabel(w, 'Your name').setValue(' Pat ')
    await inputByLabel(w, 'Choose a 4-digit PIN').setValue('2468')
    await inputByLabel(w, 'PIN again').setValue('2486')
    await buttonByText(w, 'Join Rivera').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('The two PINs don’t match.')
    expect(settingsApi.acceptMemberInvite).not.toHaveBeenCalled()

    await inputByLabel(w, 'PIN again').setValue('2468')
    await buttonByText(w, 'Join Rivera').trigger('click')
    await settle()

    expect(settingsApi.acceptMemberInvite).toHaveBeenCalledWith({ name: 'client-1' }, {
      token: 'invite-token', displayName: 'Pat', color: expect.stringMatching(/^#[0-9A-F]{6}$/), pin: '2468',
    })
    expect(ended).toEqual(['client-1'])
    expect(router.currentRoute.value.path).toBe('/home')
    expect(settingsApi.revokeMemberInvite).not.toHaveBeenCalled()
    w.unmount()
  })

  it('Cancel before anyone signs in deletes the invite and returns home', async () => {
    const w = await mountFlow()
    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/home')
    expect(adult.newAdultClient).not.toHaveBeenCalled()
    expect(settingsApi.revokeMemberInvite).toHaveBeenCalledWith('invite-token')
    w.unmount()
  })

  it('a failed invite deletion still returns home', async () => {
    settingsApi.revokeMemberInvite.mockRejectedValue(new SettingsError('offline', 'network'))
    const w = await mountFlow()
    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('holds Night Mode off while the flow is open', async () => {
    const store = useHouseholdStore()
    store.snapshot = { ...store.snapshot!, household: { ...store.snapshot!.household, nightMode: { start: '14:00', end: '16:00' } } }
    const modes = useModesStore()
    const w = await mountFlow()
    expect(modes.nightActive).toBe(false)

    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(modes.nightActive).toBe(true)
    w.unmount()
  })

  it('Cancel on the sign-in form returns home and disposes of its client', async () => {
    const w = await mountFlow()
    await buttonByText(w, 'I’m the new adult').trigger('click')
    await inputByLabel(w, 'Email').setValue('pat@example.com')
    await buttonByText(w, 'Email me a 6-digit code').trigger('click')
    await settle()
    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/home')
    expect(adult.disposeAdultClient).toHaveBeenCalledWith({ name: 'client-1' })
    w.unmount()
  })

  it('Cancel after the new adult signed in ends their sign-in and returns home', async () => {
    const w = await mountFlow()
    await buttonByText(w, 'I’m the new adult').trigger('click')
    await signIn(w)
    await consent(w)
    expect(w.find('h1').text()).toBe('About you')

    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(settingsApi.acceptMemberInvite).not.toHaveBeenCalled()
    expect(settingsApi.revokeMemberInvite).toHaveBeenCalledWith('invite-token')
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('shows an expired invite, and Cancel then signs the new adult out', async () => {
    settingsApi.acceptMemberInvite.mockRejectedValue(new SettingsError('invalid or expired invite', 'invalid'))
    const w = await mountFlow()
    await buttonByText(w, 'I’m the new adult').trigger('click')
    await signIn(w)
    await consent(w)
    await inputByLabel(w, 'Your name').setValue('Pat')
    await inputByLabel(w, 'Choose a 4-digit PIN').setValue('2468')
    await inputByLabel(w, 'PIN again').setValue('2468')
    await buttonByText(w, 'Join Rivera').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('Invalid or expired invite.')
    expect(ended).toEqual([])
    await buttonByText(w, 'Cancel').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('5 minutes without a touch ends the flow and the new adult’s sign-in', async () => {
    const w = await mountFlow()
    await buttonByText(w, 'I’m the new adult').trigger('click')
    await signIn(w)

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(settingsApi.revokeMemberInvite).toHaveBeenCalledWith('invite-token')
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })

  it('5 minutes without a touch on the hand-off screen returns home', async () => {
    const w = await mountFlow()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await settle()
    expect(router.currentRoute.value.path).toBe('/home')
    w.unmount()
  })
})
