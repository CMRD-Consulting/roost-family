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
const display = vi.hoisted(() => ({
  identity: { displayId: 'display-kitchen', householdId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Kitchen' } as unknown,
  markRemoved: vi.fn(),
  markSignedOut: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/session/displayStore', () => ({ useDisplayStore: () => display }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'
/** What every PIN-checked call should carry: the Settings session's membership and PIN, resent every time. */
const SAM_PIN = { membershipId: SAM, pin: '1234' }

const MEMBERS = [
  { membershipId: SAM, displayName: 'Sam', color: '#653437', role: 'owner', joinedAt: '2026-01-02T15:00:00Z' },
  { membershipId: ALEX, displayName: 'Alex', color: '#2C7F8C', role: 'adult', joinedAt: '2026-03-10T15:00:00Z' },
]
const DISPLAYS = [
  { displayId: 'display-kitchen', name: 'Kitchen', lastSeenAt: '2026-09-14T18:59:40Z', connected: true },
  { displayId: 'display-playroom', name: 'Playroom', lastSeenAt: '2026-09-14T16:00:00Z', connected: true },
]

type Fake = SettingsApi & Record<
  | 'settingsVerify' | 'listHouseholdMembers' | 'listHouseholdDisplays' | 'setMemberRolePin' | 'removeMemberPin'
  | 'createMemberInvitePin' | 'renameDisplayPin' | 'revokeDisplayPin' | 'signOutDisplayPin' | 'deleteHouseholdPin',
  ReturnType<typeof vi.fn>
>

function fakeApi(): Fake {
  return {
    settingsVerify: vi.fn(async ({ membershipId }: { membershipId: string }) =>
      membershipId === SAM ? { role: 'owner', displayName: 'Sam' } : { role: 'adult', displayName: 'Alex' }),
    listHouseholdMembers: vi.fn().mockResolvedValue(MEMBERS),
    listHouseholdDisplays: vi.fn().mockResolvedValue(DISPLAYS),
    setMemberRolePin: vi.fn().mockResolvedValue(undefined),
    removeMemberPin: vi.fn().mockResolvedValue(undefined),
    createMemberInvitePin: vi.fn().mockResolvedValue({ token: 'invite-token', expiresAt: '2026-09-14T19:10:00Z' }),
    renameDisplayPin: vi.fn().mockResolvedValue(undefined),
    revokeDisplayPin: vi.fn().mockResolvedValue(undefined),
    signOutDisplayPin: vi.fn().mockResolvedValue(undefined),
    deleteHouseholdPin: vi.fn().mockResolvedValue(undefined),
  } as never
}

let settingsApi: Fake
let pinia: Pinia
let router: Router

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
      { path: '/setup', component: Stub },
      { path: '/join-adult', component: Stub },
    ],
  })
  await router.push('/settings')
  await router.isReady()
  const w = mount(section, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await settle()
  return w
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  pinia = createPinia()
  setActivePinia(pinia)
  useHouseholdStore().snapshot = buildDemoSnapshot(new Date())
  settingsApi = fakeApi()
  api.current = settingsApi
  takePendingInvite()
  display.markRemoved.mockReset().mockResolvedValue(undefined)
  display.markSignedOut.mockReset().mockResolvedValue(undefined)
  display.refresh.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.innerHTML = ''
  resetSettingsApiLoaderForTests()
  vi.useRealTimers()
})

describe('the Settings PIN authorises the owner sections', () => {
  it.each([
    ['Members', MembersSection],
    ['Displays', DisplaysSection],
    ['Delete household', DeleteHouseholdSection],
  ])('%s never asks for an email sign-in and acts on the PIN session', async (heading, section) => {
    const w = await mountSection(section as Component)

    expect(w.find('h2').text()).toBe(heading)
    expect(w.text()).not.toContain('Sign in as an owner')
    expect(w.text()).not.toContain('6-digit code')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(false)
    expect(w.find('[data-testid="owner-only"]').exists()).toBe(false)
    w.unmount()
  })

  it.each([
    ['Members', MembersSection, 'Only an owner can manage members.'],
    ['Displays', DisplaysSection, 'Only an owner can manage displays.'],
    ['Delete household', DeleteHouseholdSection, 'Only an owner can delete the household.'],
  ])('%s tells an adult who is not an owner, and offers nothing', async (_heading, section, message) => {
    const w = await mountSection(section as Component, ALEX, '5678')

    expect(w.find('[data-testid="owner-only"]').text()).toContain(message)
    expect(settingsApi.listHouseholdMembers).not.toHaveBeenCalled()
    expect(settingsApi.listHouseholdDisplays).not.toHaveBeenCalled()
    expect(w.findAll('button').map((b) => b.text())).not.toContain('Remove')
    w.unmount()
  })

  it('holds nothing off: with no sign-in of its own, Night Mode is free to start as in any other section', async () => {
    const modes = useModesStore()
    const w = await mountSection(MembersSection)

    expect(modes.nightHeld).toBe(false)
    w.unmount()
  })
})

describe('MembersSection', () => {
  it('lists members with role and joined date; the only owner cannot be demoted', async () => {
    const w = await mountSection(MembersSection)

    expect(settingsApi.listHouseholdMembers).toHaveBeenCalledWith(HOUSEHOLD)
    const sam = w.find(`[data-testid="member-${SAM}"]`)
    expect(sam.text()).toContain('Sam (you)')
    expect(sam.text()).toContain('Owner · Joined Jan 2, 2026')
    expect(buttonByText(sam, 'Make adult').attributes('disabled')).toBeDefined()
    expect(sam.text()).toContain('The only owner.')
    expect(sam.findAll('button').some((b) => b.text() === 'Remove')).toBe(false)
    expect(w.find(`[data-testid="member-${ALEX}"]`).text()).toContain('Adult · Joined Mar 10, 2026')
    w.unmount()
  })

  it('changes a role with the PIN and reloads the list', async () => {
    const w = await mountSection(MembersSection)
    settingsApi.listHouseholdMembers.mockResolvedValue([MEMBERS[0], { ...MEMBERS[1], role: 'owner' }])

    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Make owner').trigger('click')
    await settle()

    expect(settingsApi.setMemberRolePin).toHaveBeenCalledWith(SAM_PIN, ALEX, 'owner')
    expect(w.text()).toContain('Alex is now an owner.')
    expect(w.find(`[data-testid="member-${ALEX}"]`).text()).toContain('Owner')
    expect(buttonByText(w.find(`[data-testid="member-${SAM}"]`), 'Make adult').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('stops offering owner actions once the owner makes themself an adult', async () => {
    settingsApi.listHouseholdMembers.mockResolvedValue([MEMBERS[0], { ...MEMBERS[1], role: 'owner' }])
    const w = await mountSection(MembersSection)

    await buttonByText(w.find(`[data-testid="member-${SAM}"]`), 'Make adult').trigger('click')
    await settle()

    expect(settingsApi.setMemberRolePin).toHaveBeenCalledWith(SAM_PIN, SAM, 'adult')
    expect(w.find('[data-testid="owner-only"]').text()).toContain('You’re an adult in Rivera now. An owner manages members.')
    expect(w.find(`[data-testid="member-${ALEX}"]`).exists()).toBe(false)
    // The Settings session itself is untouched: Children and the rest still work.
    expect(useSettingsSessionStore().info?.membershipId).toBe(SAM)
    w.unmount()
  })

  it('shows the server refusing a role change', async () => {
    settingsApi.setMemberRolePin.mockRejectedValue(new SettingsError('a household must keep at least one owner', 'invalid'))
    const w = await mountSection(MembersSection)
    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Make owner').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('A household must keep at least one owner.')
    w.unmount()
  })

  it('shows the server refusing a wrong PIN, and keeps the list', async () => {
    settingsApi.removeMemberPin.mockRejectedValue(new SettingsError('incorrect PIN', 'auth'))
    const w = await mountSection(MembersSection)
    const alex = () => w.find(`[data-testid="member-${ALEX}"]`)

    await buttonByText(alex(), 'Remove').trigger('click')
    await buttonByText(alex(), 'Remove Alex').trigger('click')
    await settle()

    expect(settingsApi.removeMemberPin).toHaveBeenCalledWith(SAM_PIN, ALEX)
    expect(w.find('[role="alert"]').text()).toBe('Roost Family didn’t accept that sign-in. Sign in again.')
    expect(alex().exists()).toBe(true)
    w.unmount()
  })

  it('removes a member after confirming', async () => {
    const w = await mountSection(MembersSection)
    const alex = () => w.find(`[data-testid="member-${ALEX}"]`)

    await buttonByText(alex(), 'Remove').trigger('click')
    expect(alex().text()).toContain('Remove Alex from Rivera?')
    expect(settingsApi.removeMemberPin).not.toHaveBeenCalled()
    settingsApi.listHouseholdMembers.mockResolvedValue([MEMBERS[0]])
    await buttonByText(alex(), 'Remove Alex').trigger('click')
    await settle()

    expect(settingsApi.removeMemberPin).toHaveBeenCalledWith(SAM_PIN, ALEX)
    expect(w.text()).toContain('Alex was removed from Rivera.')
    expect(alex().exists()).toBe(false)
    expect(useSettingsSessionStore().info?.membershipId).toBe(SAM)
    w.unmount()
  })

  it('adding an adult makes the invite on the PIN, ends the Settings session and opens the join flow', async () => {
    const w = await mountSection(MembersSection)

    await buttonByText(w, 'Add adult').trigger('click')
    const owner = w.find('[role="radiogroup"][aria-label="Role for the new adult"]').findAll('[role="radio"]')[1]!
    await owner.trigger('click')
    await buttonByText(w, 'Continue').trigger('click')
    await settle()

    expect(settingsApi.createMemberInvitePin).toHaveBeenCalledWith(SAM_PIN, 'owner')
    expect(useSettingsSessionStore().info).toBeNull()
    expect(useSettingsSessionStore().auth).toBeNull()
    expect(router.currentRoute.value.path).toBe('/join-adult')
    expect(takePendingInvite()).toEqual({ token: 'invite-token', role: 'owner' })
    w.unmount()
  })

  it('a refused invite keeps Settings open', async () => {
    settingsApi.createMemberInvitePin.mockRejectedValue(new SettingsError('only an owner can add an adult', 'auth'))
    const w = await mountSection(MembersSection)
    await buttonByText(w, 'Add adult').trigger('click')
    await buttonByText(w, 'Continue').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('Roost Family didn’t accept that sign-in. Sign in again.')
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

    expect(settingsApi.listHouseholdDisplays).toHaveBeenCalledWith(HOUSEHOLD)
    const kitchen = w.find('[data-testid="display-display-kitchen"]')
    expect(kitchen.text()).toContain('This display')
    expect(kitchen.text()).toContain('Last seen just now')
    const playroom = w.find('[data-testid="display-display-playroom"]')
    expect(playroom.text()).not.toContain('This display')
    expect(playroom.text()).toContain('Last seen 3 hours ago')
    w.unmount()
  })

  it('renames a display on the PIN, validating the name', async () => {
    const w = await mountSection(DisplaysSection)
    const playroom = () => w.find('[data-testid="display-display-playroom"]')

    await buttonByText(playroom(), 'Rename').trigger('click')
    await inputByLabel(w, 'Display name').setValue('  ')
    await buttonByText(playroom(), 'Save name').trigger('click')
    await settle()
    expect(w.find('[role="alert"]').text()).toBe('Name this display.')

    await inputByLabel(w, 'Display name').setValue('Den')
    await buttonByText(playroom(), 'Save name').trigger('click')
    await settle()
    expect(settingsApi.renameDisplayPin).toHaveBeenCalledWith(SAM_PIN, 'display-playroom', 'Den')
    expect(w.text()).toContain('Renamed to Den.')
    expect(display.refresh).not.toHaveBeenCalled()
    w.unmount()
  })

  it('removes another display after confirming and stays in Settings', async () => {
    const w = await mountSection(DisplaysSection)
    const playroom = () => w.find('[data-testid="display-display-playroom"]')

    await buttonByText(playroom(), 'Remove').trigger('click')
    expect(playroom().text()).toContain('Remove Playroom?')
    settingsApi.listHouseholdDisplays.mockResolvedValue([DISPLAYS[0]])
    await buttonByText(playroom(), 'Remove Playroom').trigger('click')
    await settle()

    expect(settingsApi.revokeDisplayPin).toHaveBeenCalledWith(SAM_PIN, 'display-playroom')
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(playroom().exists()).toBe(false)
    w.unmount()
  })

  it('removing this display forgets the household here and shows the removed screen', async () => {
    const w = await mountSection(DisplaysSection)
    const kitchen = w.find('[data-testid="display-display-kitchen"]')

    await buttonByText(kitchen, 'Remove').trigger('click')
    expect(w.text()).toContain('This is the display you’re using.')
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Remove Kitchen').trigger('click')
    await settle()

    expect(settingsApi.revokeDisplayPin).toHaveBeenCalledWith(SAM_PIN, 'display-kitchen')
    expect(display.markRemoved).toHaveBeenCalled()
    expect(useSettingsSessionStore().info).toBeNull()
    expect(router.currentRoute.value.path).toBe('/removed')
    w.unmount()
  })

  it('offers Sign out only on the display in use, and says what it keeps', async () => {
    const w = await mountSection(DisplaysSection)
    const playroom = w.find('[data-testid="display-display-playroom"]')
    expect(playroom.findAll('button').map((b) => b.text())).toEqual(['Rename', 'Remove'])

    const kitchen = w.find('[data-testid="display-display-kitchen"]')
    await buttonByText(kitchen, 'Sign out').trigger('click')
    const text = w.find('[data-testid="display-display-kitchen"]').text()
    expect(text).toContain('Kitchen stays in Rivera with its name and history')
    expect(text).toContain('Join a household')
    expect(settingsApi.signOutDisplayPin).not.toHaveBeenCalled()
    w.unmount()
  })

  it('signing this display out ends Settings, clears the tablet and opens setup', async () => {
    const w = await mountSection(DisplaysSection)
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Sign out').trigger('click')
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Sign out Kitchen').trigger('click')
    await settle()

    expect(settingsApi.signOutDisplayPin).toHaveBeenCalledWith(SAM_PIN)
    expect(settingsApi.revokeDisplayPin).not.toHaveBeenCalled()
    expect(display.markSignedOut).toHaveBeenCalled()
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(useSettingsSessionStore().info).toBeNull()
    expect(router.currentRoute.value.path).toBe('/setup')
    w.unmount()
  })

  it('a refused sign-out keeps the tablet signed in and says why', async () => {
    settingsApi.signOutDisplayPin.mockRejectedValue(new SettingsError('incorrect PIN', 'auth'))
    const w = await mountSection(DisplaysSection)
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Sign out').trigger('click')
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Sign out Kitchen').trigger('click')
    await settle()

    expect(display.markSignedOut).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(w.find('[role="alert"]').exists()).toBe(true)
    w.unmount()
  })

  it('a signed-out display says so instead of when it was last seen', async () => {
    settingsApi.listHouseholdDisplays.mockResolvedValue([DISPLAYS[0], { ...DISPLAYS[1], connected: false }])
    const w = await mountSection(DisplaysSection)
    const playroom = w.find('[data-testid="display-display-playroom"]')
    expect(playroom.text()).toContain('Signed out')
    expect(playroom.text()).not.toContain('Last seen')
    w.unmount()
  })
})

describe('DeleteHouseholdSection', () => {
  it('explains the deletion and needs the typed household name, then deletes on the PIN', async () => {
    const w = await mountSection(DeleteHouseholdSection)
    expect(w.text()).toContain('within 30 days')

    const del = () => buttonByText(w, 'Delete Rivera')
    expect(del().attributes('disabled')).toBeDefined()
    await inputByLabel(w, 'Type Rivera to confirm').setValue('rivera')
    expect(del().attributes('disabled')).toBeDefined()
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera ')
    expect(del().attributes('disabled')).toBeUndefined()

    await del().trigger('click')
    await settle()

    expect(settingsApi.deleteHouseholdPin).toHaveBeenCalledWith(SAM_PIN, 'Rivera')
    expect(display.markRemoved).toHaveBeenCalled()
    expect(useSettingsSessionStore().info).toBeNull()
    expect(router.currentRoute.value.path).toBe('/removed')
    w.unmount()
  })

  it('shows a failed deletion and stays put', async () => {
    settingsApi.deleteHouseholdPin.mockRejectedValue(new SettingsError('fetch failed', 'network'))
    const w = await mountSection(DeleteHouseholdSection)
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera')
    await buttonByText(w, 'Delete Rivera').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    w.unmount()
  })

  it('refuses a wrong PIN at the server and stays put', async () => {
    settingsApi.deleteHouseholdPin.mockRejectedValue(new SettingsError('incorrect PIN', 'auth'))
    const w = await mountSection(DeleteHouseholdSection)
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera')
    await buttonByText(w, 'Delete Rivera').trigger('click')
    await settle()

    expect(settingsApi.deleteHouseholdPin).toHaveBeenCalledWith(SAM_PIN, 'Rivera')
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(display.markRemoved).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/settings')
    w.unmount()
  })

  it('an adult who is not an owner sees no confirmation field at all', async () => {
    const w = await mountSection(DeleteHouseholdSection, ALEX, '5678')
    expect(w.find('[data-testid="owner-only"]').exists()).toBe(true)
    expect(w.findAll('label').some((l) => l.text().startsWith('Type Rivera'))).toBe(false)
    expect(settingsApi.deleteHouseholdPin).not.toHaveBeenCalled()
    w.unmount()
  })
})
