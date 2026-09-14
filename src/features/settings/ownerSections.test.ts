import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h, type Component } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import DeleteHouseholdSection from './sections/DeleteHouseholdSection.vue'
import DisplaysSection from './sections/DisplaysSection.vue'
import MembersSection from './sections/MembersSection.vue'
import { takePendingInvite } from './pendingInvite'
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
const display = vi.hoisted(() => ({
  identity: { displayId: 'display-kitchen', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' } as unknown,
  markRemoved: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/session/adultSession', () => adult)
vi.mock('@/session/displayStore', () => ({ useDisplayStore: () => display }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'
const OWNER_CLIENT = { name: 'client-1' }

const MEMBERS = [
  { membershipId: SAM, displayName: 'Sam', color: '#653437', role: 'owner', joinedAt: '2026-01-02T15:00:00Z' },
  { membershipId: ALEX, displayName: 'Alex', color: '#2C7F8C', role: 'adult', joinedAt: '2026-03-10T15:00:00Z' },
]
const DISPLAYS = [
  { displayId: 'display-kitchen', name: 'Kitchen', lastSeenAt: '2026-09-14T18:59:40Z' },
  { displayId: 'display-playroom', name: 'Playroom', lastSeenAt: '2026-09-14T16:00:00Z' },
]

type Fake = SettingsApi & Record<
  | 'settingsVerify' | 'adultMembership' | 'listMembers' | 'listDisplays' | 'setMemberRole' | 'removeMember'
  | 'createMemberInvite' | 'recordConsent' | 'acceptMemberInvite' | 'renameDisplay' | 'revokeDisplay' | 'deleteHousehold',
  ReturnType<typeof vi.fn>
>

function fakeApi(): Fake {
  return {
    settingsVerify: vi.fn(async ({ membershipId }: { membershipId: string }) =>
      membershipId === SAM ? { role: 'owner', displayName: 'Sam' } : { role: 'adult', displayName: 'Alex' }),
    adultMembership: vi.fn().mockResolvedValue({ membershipId: SAM, role: 'owner' }),
    listMembers: vi.fn().mockResolvedValue(MEMBERS),
    listDisplays: vi.fn().mockResolvedValue(DISPLAYS),
    setMemberRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    createMemberInvite: vi.fn().mockResolvedValue({ token: 'invite-token', expiresAt: '2026-09-14T19:10:00Z' }),
    recordConsent: vi.fn().mockResolvedValue(undefined),
    acceptMemberInvite: vi.fn().mockResolvedValue('membership-pat'),
    renameDisplay: vi.fn().mockResolvedValue(undefined),
    revokeDisplay: vi.fn().mockResolvedValue(undefined),
    deleteHousehold: vi.fn().mockResolvedValue(undefined),
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

async function mountSection(section: Component, membershipId = SAM, pin = '1234'): Promise<VueWrapper> {
  const session = useSettingsSessionStore()
  session.init(settingsApi)
  await session.enter(membershipId, pin)
  const Stub = defineComponent({ render: () => h('p', 'stub') })
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/:section?', component: Stub },
      { path: '/removed', component: Stub },
      { path: '/join-adult', component: Stub },
    ],
  })
  await router.push('/settings')
  await router.isReady()
  const w = mount(section, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await settle()
  return w
}

async function signIn(w: VueWrapper, email = 'sam@example.com') {
  await inputByLabel(w, 'Email').setValue(email)
  await buttonByText(w, 'Email me a 6-digit code').trigger('click')
  await settle()
  await inputByLabel(w, '6-digit code').setValue('123456')
  await buttonByText(w, 'Sign in').trigger('click')
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
  takePendingInvite()
  adult.resetClients()
  adult.sendEmailCode.mockReset().mockResolvedValue(undefined)
  adult.disposeAdultClient.mockReset().mockResolvedValue(undefined)
  adult.verifyEmailCode.mockReset().mockImplementation(async (client: { name: string }, email: string) => ({
    client, userId: `user-${email}`, email, end: vi.fn(async () => void ended.push(client.name)),
  }))
  display.markRemoved.mockReset().mockResolvedValue(undefined)
  display.refresh.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.innerHTML = ''
  resetSettingsApiLoaderForTests()
  vi.useRealTimers()
})

describe('owner sign-in', () => {
  it('asks for an owner sign-in before showing anything', async () => {
    const w = await mountSection(MembersSection)
    expect(w.text()).toContain('Sign in as an owner')
    expect(settingsApi.listMembers).not.toHaveBeenCalled()
    w.unmount()
  })

  it('refuses an account that is not an owner, and ends its sign-in', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: ALEX, role: 'adult' })
    const w = await mountSection(MembersSection)
    await signIn(w, 'alex@example.com')

    expect(settingsApi.adultMembership).toHaveBeenCalledWith(OWNER_CLIENT, HOUSEHOLD, 'user-alex@example.com')
    expect(w.text()).toContain('Only an owner can manage this.')
    expect(ended).toEqual(['client-1'])
    expect(settingsApi.listMembers).not.toHaveBeenCalled()
    expect(w.findAll('button').some((b) => b.text() === 'Sign in as a different adult')).toBe(true)
    w.unmount()
  })

  it('moves focus to each sign-in step as it changes, then to the section once signed in', async () => {
    settingsApi.adultMembership.mockResolvedValueOnce({ membershipId: ALEX, role: 'adult' })
    const w = await mountSection(MembersSection)
    await signIn(w, 'alex@example.com')
    expect(document.activeElement?.textContent).toBe('Only an owner can manage this.')

    await buttonByText(w, 'Sign in as a different adult').trigger('click')
    await settle()
    expect(document.activeElement?.textContent).toBe('Sign in as an owner')

    await signIn(w)
    expect(document.activeElement).toBe(w.find('h2').element)
    expect(w.find('h2').text()).toBe('Members')
    expect(w.find('h2').attributes('tabindex')).toBe('-1')
    w.unmount()
  })

  it('holds Night Mode off during the sign-in and while signed in, not after signing out', async () => {
    const store = useHouseholdStore()
    store.snapshot = { ...store.snapshot!, household: { ...store.snapshot!.household, nightMode: { start: '14:00', end: '16:00' } } }
    const modes = useModesStore()
    const w = await mountSection(MembersSection)
    expect(modes.nightActive).toBe(false)
    await signIn(w)
    expect(w.text()).toContain('Alex')
    expect(modes.nightActive).toBe(false)

    await buttonByText(w, 'Add adult').trigger('click')
    await buttonByText(w, 'Continue').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    w.unmount()
    expect(modes.nightActive).toBe(true)
  })

  it('signs the owner out after 5 minutes without a touch, and when the section closes', async () => {
    const w = await mountSection(MembersSection)
    await signIn(w)
    expect(w.text()).toContain('Alex')

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('Signed out after 5 minutes without a touch.')
    expect(w.find(`[data-testid="member-${ALEX}"]`).exists()).toBe(false)
    w.unmount()

    const again = await mountSection(DisplaysSection)
    await signIn(again)
    again.unmount()
    expect(ended).toEqual(['client-1', 'client-2'])
  })
})

describe('MembersSection', () => {
  it('lists members with role and joined date; the only owner cannot be demoted', async () => {
    const w = await mountSection(MembersSection)
    await signIn(w)

    expect(settingsApi.listMembers).toHaveBeenCalledWith(OWNER_CLIENT, HOUSEHOLD)
    const sam = w.find(`[data-testid="member-${SAM}"]`)
    expect(sam.text()).toContain('Sam (you)')
    expect(sam.text()).toContain('Owner · Joined Jan 2, 2026')
    expect(buttonByText(sam, 'Make adult').attributes('disabled')).toBeDefined()
    expect(sam.text()).toContain('The only owner.')
    expect(sam.findAll('button').some((b) => b.text() === 'Remove')).toBe(false)
    expect(w.find(`[data-testid="member-${ALEX}"]`).text()).toContain('Adult · Joined Mar 10, 2026')
    w.unmount()
  })

  it('changes a role and reloads the list', async () => {
    const w = await mountSection(MembersSection)
    await signIn(w)
    settingsApi.listMembers.mockResolvedValue([MEMBERS[0], { ...MEMBERS[1], role: 'owner' }])

    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Make owner').trigger('click')
    await settle()

    expect(settingsApi.setMemberRole).toHaveBeenCalledWith(OWNER_CLIENT, ALEX, 'owner')
    expect(w.text()).toContain('Alex is now an owner.')
    expect(w.find(`[data-testid="member-${ALEX}"]`).text()).toContain('Owner')
    expect(buttonByText(w.find(`[data-testid="member-${SAM}"]`), 'Make adult').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('shows the server refusing a role change', async () => {
    settingsApi.setMemberRole.mockRejectedValue(new SettingsError('a household must keep at least one owner', 'invalid'))
    const w = await mountSection(MembersSection)
    await signIn(w)
    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Make owner').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('A household must keep at least one owner.')
    w.unmount()
  })

  it('removes a member after confirming', async () => {
    const w = await mountSection(MembersSection)
    await signIn(w)
    const alex = () => w.find(`[data-testid="member-${ALEX}"]`)

    await buttonByText(alex(), 'Remove').trigger('click')
    expect(alex().text()).toContain('Remove Alex from Rivera?')
    expect(settingsApi.removeMember).not.toHaveBeenCalled()
    settingsApi.listMembers.mockResolvedValue([MEMBERS[0]])
    await buttonByText(alex(), 'Remove Alex').trigger('click')
    await settle()

    expect(settingsApi.removeMember).toHaveBeenCalledWith(OWNER_CLIENT, ALEX)
    expect(w.text()).toContain('Alex was removed from Rivera.')
    expect(alex().exists()).toBe(false)
    expect(useSettingsSessionStore().info?.membershipId).toBe(SAM)
    w.unmount()
  })

  it('adding an adult makes the invite, ends the owner sign-in and the Settings session, and opens the join flow', async () => {
    const w = await mountSection(MembersSection)
    await signIn(w)

    await buttonByText(w, 'Add adult').trigger('click')
    const owner = w.find('[role="radiogroup"][aria-label="Role for the new adult"]').findAll('[role="radio"]')[1]!
    await owner.trigger('click')
    await buttonByText(w, 'Continue').trigger('click')
    await settle()

    expect(settingsApi.createMemberInvite).toHaveBeenCalledWith(OWNER_CLIENT, HOUSEHOLD, 'owner')
    expect(ended).toEqual(['client-1'])
    expect(useSettingsSessionStore().info).toBeNull()
    expect(useSettingsSessionStore().auth).toBeNull()
    expect(router.currentRoute.value.path).toBe('/join-adult')
    expect(takePendingInvite()).toEqual({ token: 'invite-token', role: 'owner' })
    w.unmount()
  })

  it('a refused invite keeps the owner signed in and Settings open', async () => {
    settingsApi.createMemberInvite.mockRejectedValue(new SettingsError('only an owner can add an adult', 'auth'))
    const w = await mountSection(MembersSection)
    await signIn(w)
    await buttonByText(w, 'Add adult').trigger('click')
    await buttonByText(w, 'Continue').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('Roost Family didn’t accept that sign-in. Sign in again.')
    expect(ended).toEqual([])
    expect(useSettingsSessionStore().info?.membershipId).toBe(SAM)
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(takePendingInvite()).toBeNull()
    w.unmount()
  })
})

describe('DisplaysSection', () => {
  it('lists displays with last-seen times and marks this one', async () => {
    const w = await mountSection(DisplaysSection)
    expect(w.text()).toContain('Join a household')
    await signIn(w)

    expect(settingsApi.listDisplays).toHaveBeenCalledWith(OWNER_CLIENT, HOUSEHOLD)
    const kitchen = w.find('[data-testid="display-display-kitchen"]')
    expect(kitchen.text()).toContain('This display')
    expect(kitchen.text()).toContain('Last seen just now')
    const playroom = w.find('[data-testid="display-display-playroom"]')
    expect(playroom.text()).not.toContain('This display')
    expect(playroom.text()).toContain('Last seen 3 hours ago')
    w.unmount()
  })

  it('renames a display, validating the name', async () => {
    const w = await mountSection(DisplaysSection)
    await signIn(w)
    const playroom = () => w.find('[data-testid="display-display-playroom"]')

    await buttonByText(playroom(), 'Rename').trigger('click')
    await inputByLabel(w, 'Display name').setValue('  ')
    await buttonByText(playroom(), 'Save name').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('Name this display.')

    await inputByLabel(w, 'Display name').setValue('Den')
    await buttonByText(playroom(), 'Save name').trigger('click')
    await settle()
    expect(settingsApi.renameDisplay).toHaveBeenCalledWith(OWNER_CLIENT, 'display-playroom', 'Den')
    expect(w.text()).toContain('Renamed to Den.')
    expect(display.refresh).not.toHaveBeenCalled()
    w.unmount()
  })

  it('removes another display after confirming and stays in Settings', async () => {
    const w = await mountSection(DisplaysSection)
    await signIn(w)
    const playroom = () => w.find('[data-testid="display-display-playroom"]')

    await buttonByText(playroom(), 'Remove').trigger('click')
    expect(playroom().text()).toContain('Remove Playroom?')
    settingsApi.listDisplays.mockResolvedValue([DISPLAYS[0]])
    await buttonByText(playroom(), 'Remove Playroom').trigger('click')
    await settle()

    expect(settingsApi.revokeDisplay).toHaveBeenCalledWith(OWNER_CLIENT, 'display-playroom')
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(playroom().exists()).toBe(false)
    w.unmount()
  })

  it('removing this display forgets the household here and shows the removed screen', async () => {
    const w = await mountSection(DisplaysSection)
    await signIn(w)
    const kitchen = w.find('[data-testid="display-display-kitchen"]')

    await buttonByText(kitchen, 'Remove').trigger('click')
    expect(w.text()).toContain('This is the display you’re using.')
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Remove Kitchen').trigger('click')
    await settle()

    expect(settingsApi.revokeDisplay).toHaveBeenCalledWith(OWNER_CLIENT, 'display-kitchen')
    expect(display.markRemoved).toHaveBeenCalled()
    expect(ended).toEqual(['client-1'])
    expect(router.currentRoute.value.path).toBe('/removed')
    w.unmount()
  })
})

describe('DeleteHouseholdSection', () => {
  it('explains the deletion and needs an owner sign-in and the typed household name', async () => {
    const w = await mountSection(DeleteHouseholdSection)
    expect(w.text()).toContain('within 30 days')
    expect(w.findAll('button').some((b) => b.text() === 'Delete Rivera')).toBe(false)
    await signIn(w)

    const del = () => buttonByText(w, 'Delete Rivera')
    expect(del().attributes('disabled')).toBeDefined()
    await inputByLabel(w, 'Type Rivera to confirm').setValue('rivera')
    expect(del().attributes('disabled')).toBeDefined()
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera ')
    expect(del().attributes('disabled')).toBeUndefined()

    await del().trigger('click')
    await settle()

    expect(settingsApi.deleteHousehold).toHaveBeenCalledWith(OWNER_CLIENT, HOUSEHOLD, 'Rivera')
    expect(ended).toEqual(['client-1'])
    expect(display.markRemoved).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/removed')
    w.unmount()
  })

  it('shows a failed deletion and stays put', async () => {
    settingsApi.deleteHousehold.mockRejectedValue(new SettingsError('fetch failed', 'network'))
    const w = await mountSection(DeleteHouseholdSection)
    await signIn(w)
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera')
    await buttonByText(w, 'Delete Rivera').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    w.unmount()
  })
})
