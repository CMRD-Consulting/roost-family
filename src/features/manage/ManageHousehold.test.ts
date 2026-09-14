import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { SettingsError, type AdultMembershipRow, type SettingsApi } from '@/data/settingsApi'
import ManageHousehold from './ManageHousehold.vue'

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

vi.mock('@/data/householdSource', () => ({ isDemo: false }))
vi.mock('@/session/adultSession', () => adult)
// Manage household must never load the display's client (or anything that reads its stored session).
vi.mock('@/data/supabase', () => {
  throw new Error('Display Supabase client loaded by Manage household')
})

const SAM_USER = 'user-sam@example.com'
const RIVERA = 'aaaaaaaa-0000-0000-0000-000000000001'
const LAKE = 'aaaaaaaa-0000-0000-0000-000000000002'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'
const SAM_LAKE = 'bbbbbbbb-0000-0000-0000-000000000003'

const RIVERA_OWNER: AdultMembershipRow = {
  membershipId: SAM, householdId: RIVERA, householdName: 'Rivera', timeZone: 'America/New_York', role: 'owner', displayName: 'Sam', color: '#653437',
}
const LAKE_ADULT: AdultMembershipRow = {
  membershipId: SAM_LAKE, householdId: LAKE, householdName: 'Lake house', timeZone: 'America/Chicago', role: 'adult', displayName: 'Sammy', color: '#2C7F8C',
}
const BEACH_OWNER: AdultMembershipRow = {
  membershipId: 'bbbbbbbb-0000-0000-0000-000000000004', householdId: 'aaaaaaaa-0000-0000-0000-000000000003', householdName: 'Beach', timeZone: 'UTC', role: 'owner', displayName: 'Sam', color: '#653437',
}
const MEMBERS = [
  { membershipId: SAM, displayName: 'Sam', color: '#653437', role: 'owner', joinedAt: '2026-01-02T15:00:00Z' },
  { membershipId: ALEX, displayName: 'Alex', color: '#2C7F8C', role: 'adult', joinedAt: '2026-03-10T15:00:00Z' },
]
const DISPLAYS = [
  { displayId: 'display-kitchen', name: 'Kitchen', lastSeenAt: '2026-09-14T18:59:40Z' },
  { displayId: 'display-playroom', name: 'Playroom', lastSeenAt: '2026-09-14T16:00:00Z' },
]

type Fake = SettingsApi & Record<
  'myMemberships' | 'listMembers' | 'listDisplays' | 'removeMember' | 'renameDisplay' | 'revokeDisplay' | 'deleteHousehold' | 'leaveHousehold',
  ReturnType<typeof vi.fn>
>

function fakeApi(): Fake {
  return {
    myMemberships: vi.fn().mockResolvedValue([RIVERA_OWNER]),
    listMembers: vi.fn().mockResolvedValue(MEMBERS),
    listDisplays: vi.fn().mockResolvedValue(DISPLAYS),
    removeMember: vi.fn().mockResolvedValue(undefined),
    renameDisplay: vi.fn().mockResolvedValue(undefined),
    revokeDisplay: vi.fn().mockResolvedValue(undefined),
    deleteHousehold: vi.fn().mockResolvedValue(undefined),
    leaveHousehold: vi.fn().mockResolvedValue(undefined),
  } as never
}

let api: Fake
let pinia: Pinia
let router: Router
const ended: string[] = []
const CLIENT = { name: 'client-1' }

async function settle() {
  await vi.advanceTimersByTimeAsync(50)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function buttonByText(w: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

function hasButton(w: Pick<VueWrapper, 'findAll'>, text: string) {
  return w.findAll('button').some((b) => b.text() === text)
}

function inputByLabel(w: VueWrapper, label: string) {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No label "${label}"`)
  return w.find(`#${CSS.escape(lab.attributes('for')!)}`)
}

async function mountPage(path = '/manage', props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}): Promise<VueWrapper> {
  const Stub = defineComponent({ render: () => h('p', 'stub') })
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/manage', component: Stub }] })
  await router.push(path)
  await router.isReady()
  const w = mount(ManageHousehold, { props: { api, ...props }, slots: slots as never, global: { plugins: [pinia, router] }, attachTo: document.body })
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

const sectionTitles = (w: VueWrapper) => w.findAll('h2').map((x) => x.text())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  pinia = createPinia()
  setActivePinia(pinia)
  api = fakeApi()
  ended.length = 0
  adult.resetClients()
  adult.sendEmailCode.mockReset().mockResolvedValue(undefined)
  adult.disposeAdultClient.mockReset().mockResolvedValue(undefined)
  adult.verifyEmailCode.mockReset().mockImplementation(async (client: { name: string }, email: string) => ({
    client, userId: `user-${email}`, email, end: vi.fn(async () => void ended.push(client.name)),
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('sign-in', () => {
  it('signs in with an emailed code on a temporary client, then opens the only household', async () => {
    const w = await mountPage()
    expect(w.find('h1').text()).toBe('Manage household')
    expect(hasButton(w, 'Cancel')).toBe(false)

    await signIn(w)

    expect(adult.sendEmailCode).toHaveBeenCalledWith(CLIENT, 'sam@example.com')
    expect(adult.verifyEmailCode).toHaveBeenCalledWith(CLIENT, 'sam@example.com', '123456')
    expect(api.myMemberships).toHaveBeenCalledWith(CLIENT, SAM_USER)
    const header = w.find('header')
    expect(header.find('h1').text()).toBe('Rivera')
    expect(header.text()).toContain('Signed in as Sam')
    expect(header.find('[role="img"]').attributes('aria-label')).toBe('Sam')
    expect(hasButton(header, 'Sign out')).toBe(true)
    w.unmount()
  })

  it('never touches the display, household or Settings session stores', async () => {
    const w = await mountPage('/manage?calendar=connected')
    await signIn(w)
    expect(Object.keys(pinia.state.value)).toEqual([])
    w.unmount()
  })

  it('moves focus to the heading of each step', async () => {
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, LAKE_ADULT])
    const w = await mountPage()
    await signIn(w)
    expect(document.activeElement?.textContent).toBe('Which household?')
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(document.activeElement).toBe(w.find('header h1').element)
    w.unmount()
  })

  it('signs out from the header', async () => {
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w.find('header'), 'Sign out').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('You’re signed out.')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    w.unmount()
  })

  it('signs out after 5 minutes without a touch', async () => {
    const w = await mountPage()
    await signIn(w)
    expect(sectionTitles(w)).toContain('Displays')

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await settle()

    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('Signed out after 5 minutes without a touch.')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    expect(sectionTitles(w)).not.toContain('Displays')
    w.unmount()
  })

  it('offers a retry when the households could not be loaded', async () => {
    api.myMemberships.mockRejectedValueOnce(new SettingsError('fetch failed', 'network'))
    const w = await mountPage()
    await signIn(w)
    expect(w.find('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')

    await buttonByText(w, 'Try again').trigger('click')
    await settle()
    expect(api.myMemberships).toHaveBeenCalledTimes(2)
    expect(w.find('header h1').text()).toBe('Rivera')
    w.unmount()
  })

  it('goes back to sign-in when the sign-in has expired', async () => {
    api.myMemberships.mockRejectedValueOnce(new SettingsError('JWT expired', 'network'))
    const w = await mountPage()
    await signIn(w)
    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    w.unmount()
  })

  it('says so when the account belongs to no household', async () => {
    api.myMemberships.mockResolvedValue([])
    const w = await mountPage()
    await signIn(w)
    expect(w.find('h1').text()).toBe('No households')
    expect(hasButton(w, 'Sign out')).toBe(true)
    w.unmount()
  })
})

describe('household picker', () => {
  it('lets an adult in several households pick one, and switch later', async () => {
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, LAKE_ADULT])
    const w = await mountPage()
    await signIn(w)

    expect(w.find('h1').text()).toBe('Which household?')
    expect(api.listDisplays).not.toHaveBeenCalled()
    await buttonByText(w, 'Lake house Adult').trigger('click')
    await settle()
    expect(w.find('header h1').text()).toBe('Lake house')
    expect(w.find('header').text()).toContain('Signed in as Sammy')

    await buttonByText(w.find('header'), 'Switch household').trigger('click')
    await settle()
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(w.find('header h1').text()).toBe('Rivera')
    expect(api.listDisplays).toHaveBeenCalledWith(CLIENT, RIVERA)
    expect(ended).toEqual([])
    w.unmount()
  })
})

describe('owner', () => {
  it('sees Displays, Members, Export and Delete household, loaded with the adult client', async () => {
    const w = await mountPage()
    await signIn(w)
    expect(sectionTitles(w)).toEqual(['Displays', 'Members', 'Export', 'Delete household'])
    expect(sectionTitles(w)).not.toContain('My account')
    expect(api.listDisplays).toHaveBeenCalledWith(CLIENT, RIVERA)
    expect(api.listMembers).toHaveBeenCalledWith(CLIENT, RIVERA)
    // Nothing that belongs to a display: no owner sign-in of its own, no role changes or adding adults.
    expect(w.text()).not.toContain('Sign in as an owner')
    expect(hasButton(w, 'Make owner')).toBe(false)
    expect(hasButton(w, 'Add adult')).toBe(false)
    expect(w.text()).not.toContain('This display')
    expect(w.text()).not.toContain('including this one')
    w.unmount()
  })

  it('says when the household has no displays', async () => {
    api.listDisplays.mockResolvedValue([])
    const w = await mountPage()
    await signIn(w)
    expect(w.text()).toContain('No displays are set up in Rivera.')
    w.unmount()
  })

  it('revokes a display after confirming', async () => {
    const w = await mountPage()
    await signIn(w)
    const kitchen = () => w.find('[data-testid="display-display-kitchen"]')
    await buttonByText(kitchen(), 'Remove').trigger('click')
    expect(kitchen().text()).toContain('Remove Kitchen?')
    api.listDisplays.mockResolvedValue([DISPLAYS[1]])
    await buttonByText(kitchen(), 'Remove Kitchen').trigger('click')
    await settle()

    expect(api.revokeDisplay).toHaveBeenCalledWith(CLIENT, 'display-kitchen')
    expect(w.text()).toContain('Kitchen was removed from Rivera.')
    expect(kitchen().exists()).toBe(false)
    expect(ended).toEqual([])
    w.unmount()
  })

  it('removes a member after confirming', async () => {
    const w = await mountPage()
    await signIn(w)
    const alex = () => w.find(`[data-testid="member-${ALEX}"]`)
    expect(hasButton(w.find(`[data-testid="member-${SAM}"]`), 'Remove')).toBe(false)
    await buttonByText(alex(), 'Remove').trigger('click')
    api.listMembers.mockResolvedValue([MEMBERS[0]])
    await buttonByText(alex(), 'Remove Alex').trigger('click')
    await settle()

    expect(api.removeMember).toHaveBeenCalledWith(CLIENT, ALEX)
    expect(w.text()).toContain('Alex was removed from Rivera.')
    w.unmount()
  })

  it('deletes the household with the typed name, then goes back to the adult’s households', async () => {
    const w = await mountPage()
    await signIn(w)
    api.myMemberships.mockResolvedValue([])
    await inputByLabel(w, 'Type Rivera to confirm').setValue('Rivera')
    await buttonByText(w, 'Delete Rivera').trigger('click')
    await settle()

    expect(api.deleteHousehold).toHaveBeenCalledWith(CLIENT, RIVERA, 'Rivera')
    expect(api.myMemberships).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Rivera was deleted.')
    expect(w.find('h1').text()).toBe('No households')
    w.unmount()
  })

  it('shows Export as a placeholder until an export handler is given', async () => {
    const w = await mountPage()
    await signIn(w)
    const placeholder = buttonByText(w, 'Export household data — coming in the next step')
    expect(placeholder.attributes('disabled')).toBeDefined()
    w.unmount()

    const onRequestExport = vi.fn().mockResolvedValue(undefined)
    const wired = await mountPage('/manage', { onRequestExport })
    await signIn(wired)
    await buttonByText(wired, 'Export household data').trigger('click')
    await settle()
    expect(onRequestExport).toHaveBeenCalledWith({ client: { name: 'client-2' }, householdId: RIVERA, membershipId: SAM })
    wired.unmount()
  })

  it('goes back to sign-in when an action finds the sign-in expired', async () => {
    api.revokeDisplay.mockRejectedValue(new SettingsError('JWT expired', 'network'))
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Remove').trigger('click')
    await buttonByText(w, 'Remove Kitchen').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    w.unmount()
  })
})

describe('adult', () => {
  it('sees My account with leaving and the calendars slot, and no owner sections', async () => {
    api.myMemberships.mockResolvedValue([LAKE_ADULT])
    const w = await mountPage('/manage', {}, {
      calendars: (p: { client: unknown; householdId: string; membershipId: string }) =>
        h('p', { 'data-testid': 'calendars' }, `${(p.client as { name: string }).name} ${p.householdId} ${p.membershipId}`),
    })
    await signIn(w)

    expect(sectionTitles(w)).toEqual(['My account'])
    expect(w.find('[data-testid="calendars"]').text()).toBe(`client-1 ${LAKE} ${SAM_LAKE}`)
    expect(api.listDisplays).not.toHaveBeenCalled()
    expect(w.text()).not.toContain('My color')
    expect(hasButton(w, 'Change my PIN')).toBe(false)
    w.unmount()
  })

  it('leaves the household after confirming, without signing in again', async () => {
    api.myMemberships.mockResolvedValue([LAKE_ADULT, RIVERA_OWNER])
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Lake house Adult').trigger('click')
    await settle()

    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(false)
    expect(w.text()).toContain('Leave Lake house?')
    api.myMemberships.mockResolvedValue([RIVERA_OWNER])
    await buttonByText(w, 'Leave Lake house').trigger('click')
    await settle()

    expect(api.leaveHousehold).toHaveBeenCalledWith(CLIENT, LAKE)
    expect(w.text()).toContain('You left Lake house.')
    expect(w.find('header h1').text()).toBe('Rivera')
    expect(ended).toEqual([])
    w.unmount()
  })
})

describe('calendar status from the connection callback', () => {
  it('shows ?calendar=connected after sign-in, and dismissing it clears the query', async () => {
    const w = await mountPage('/manage?calendar=connected')
    expect(w.text()).not.toContain('Your calendar is connected.')
    await signIn(w)

    expect(w.find('[data-testid="calendar-status"]').text()).toContain('Your calendar is connected.')
    await buttonByText(w.find('[data-testid="calendar-status"]'), 'Dismiss').trigger('click')
    await settle()
    expect(w.find('[data-testid="calendar-status"]').exists()).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/manage')
    w.unmount()
  })

  it('shows a calendar connection error in the adult’s words', async () => {
    const w = await mountPage('/manage?calendar=error&reason=access_denied')
    await signIn(w)
    const banner = w.find('[data-testid="calendar-status"]')
    expect(banner.attributes('role')).toBe('alert')
    expect(banner.text()).toContain('The calendar wasn’t connected: access wasn’t allowed.')
    w.unmount()
  })
})

describe('review fixes', () => {
  it('re-renders for the new role when an owner was made an adult elsewhere', async () => {
    const w = await mountPage()
    await signIn(w)
    api.revokeDisplay.mockRejectedValue(new SettingsError('only an owner can remove a display', 'auth'))
    api.myMemberships.mockResolvedValue([{ ...RIVERA_OWNER, role: 'adult' }])
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Remove').trigger('click')
    await buttonByText(w, 'Remove Kitchen').trigger('click')
    await settle()

    expect(api.myMemberships).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Your access to Rivera changed.')
    expect(w.find('header').text()).toContain('Signed in as Sam · Adult')
    expect(sectionTitles(w)).toEqual(['My account'])
    expect(ended).toEqual([])
    w.unmount()
  })

  it('goes back to the picker, or to No households, when the membership was removed elsewhere', async () => {
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, LAKE_ADULT, BEACH_OWNER])
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    api.removeMember.mockRejectedValue(new SettingsError('only an owner can remove a member', 'auth'))
    api.myMemberships.mockResolvedValue([LAKE_ADULT, BEACH_OWNER])
    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Remove').trigger('click')
    await buttonByText(w, 'Remove Alex').trigger('click')
    await settle()
    expect(w.find('h1').text()).toBe('Which household?')
    expect(w.text()).toContain('Your access to Rivera changed.')
    w.unmount()

    api.myMemberships.mockResolvedValue([RIVERA_OWNER])
    const alone = await mountPage()
    await signIn(alone)
    api.myMemberships.mockResolvedValue([])
    await buttonByText(alone.find(`[data-testid="member-${ALEX}"]`), 'Remove').trigger('click')
    await buttonByText(alone, 'Remove Alex').trigger('click')
    await settle()
    expect(alone.find('h1').text()).toBe('No households')
    alone.unmount()
  })

  it('keeps a plain refusal in its section when the role has not changed', async () => {
    const w = await mountPage()
    await signIn(w)
    api.removeMember.mockRejectedValue(new SettingsError('a household must keep at least one owner', 'auth'))
    await buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Remove').trigger('click')
    await buttonByText(w, 'Remove Alex').trigger('click')
    await settle()
    expect(api.myMemberships).toHaveBeenCalledTimes(2)
    expect(w.find('[role="alert"]').text()).toBe('Roost Family didn’t accept that sign-in. Sign in again.')
    expect(w.text()).not.toContain('Your access to Rivera changed.')
    w.unmount()
  })

  it('treats a client with no session left as expired', async () => {
    adult.newAdultClient.mockImplementationOnce(() => ({ name: 'client-1', auth: { getSession: async () => ({ data: { session: null } }) } }) as never)
    const w = await mountPage()
    await signIn(w)
    api.revokeDisplay.mockRejectedValue(new SettingsError('fetch failed', 'network'))
    await buttonByText(w.find('[data-testid="display-display-kitchen"]'), 'Remove').trigger('click')
    await buttonByText(w, 'Remove Kitchen').trigger('click')
    await settle()
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    w.unmount()
  })

  it('treats a 401 on loading the households as expired, not as the network', async () => {
    api.myMemberships.mockRejectedValueOnce(new SettingsError('Unauthorized', 'network', 401))
    const w = await mountPage()
    await signIn(w)
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    expect(hasButton(w, 'Try again')).toBe(false)
    w.unmount()
  })

  it('routes an expired sign-in while leaving back to sign-in', async () => {
    api.myMemberships.mockResolvedValue([LAKE_ADULT])
    api.leaveHousehold.mockRejectedValue(new SettingsError('adult sign-in required', 'auth'))
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    await buttonByText(w, 'Leave Lake house').trigger('click')
    await settle()
    expect(ended).toEqual(['client-1'])
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    w.unmount()
  })

  it('stays busy until every running load or action is done', async () => {
    const displays = deferred<typeof DISPLAYS>()
    api.listDisplays.mockReturnValue(displays.promise)
    const w = await mountPage()
    await signIn(w)
    const removeAlex = () => buttonByText(w.find(`[data-testid="member-${ALEX}"]`), 'Remove')
    expect(removeAlex().attributes('disabled')).toBeDefined()
    displays.resolve(DISPLAYS)
    await settle()
    expect(removeAlex().attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('stops listening to the client’s sign-in events when the page goes away', async () => {
    const unsubscribe = vi.fn()
    adult.newAdultClient.mockImplementationOnce(() => ({
      name: 'client-1',
      auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe } } })) },
    }) as never)
    const w = await mountPage()
    await signIn(w)
    expect(unsubscribe).not.toHaveBeenCalled()
    w.unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('forgets the calendar status on sign-out, and an export error on sign-out and household switch', async () => {
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, BEACH_OWNER])
    const onRequestExport = vi.fn().mockRejectedValue(new SettingsError('fetch failed', 'network'))
    const w = await mountPage('/manage?calendar=connected', { onRequestExport })
    await signIn(w)
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(w.find('[data-testid="calendar-status"]').exists()).toBe(true)
    await buttonByText(w, 'Export household data').trigger('click')
    await settle()
    const exportAlert = 'Couldn’t reach Roost Family. Check the connection and try again.'
    expect(w.text()).toContain(exportAlert)

    await buttonByText(w.find('header'), 'Switch household').trigger('click')
    await settle()
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(w.text()).not.toContain(exportAlert)

    await buttonByText(w, 'Export household data').trigger('click')
    await settle()
    expect(w.text()).toContain(exportAlert)
    await buttonByText(w.find('header'), 'Sign out').trigger('click')
    await settle()
    await signIn(w)
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(w.find('[data-testid="calendar-status"]').exists()).toBe(false)
    expect(w.text()).not.toContain(exportAlert)
    w.unmount()
  })

  it('moves focus to the page heading when the calendar banner is dismissed', async () => {
    const w = await mountPage('/manage?calendar=connected')
    await signIn(w)
    await buttonByText(w.find('[data-testid="calendar-status"]'), 'Dismiss').trigger('click')
    await settle()
    expect(document.activeElement).toBe(w.find('header h1').element)
    w.unmount()
  })

  it('switching between two owned households never shows the first one’s displays in the second', async () => {
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, BEACH_OWNER])
    const beachDisplays = deferred<Array<{ displayId: string; name: string; lastSeenAt: string | null }>>()
    api.listDisplays.mockImplementation((_client: unknown, householdId: string) =>
      householdId === RIVERA ? Promise.resolve(DISPLAYS) : beachDisplays.promise)
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Rivera Owner').trigger('click')
    await settle()
    expect(w.find('[data-testid="display-display-kitchen"]').exists()).toBe(true)

    await buttonByText(w.find('header'), 'Switch household').trigger('click')
    await settle()
    await buttonByText(w, 'Beach Owner').trigger('click')
    await settle()
    expect(w.find('header h1').text()).toBe('Beach')
    expect(w.find('[data-testid="display-display-kitchen"]').exists()).toBe(false)
    beachDisplays.resolve([{ displayId: 'display-porch', name: 'Porch', lastSeenAt: null }])
    await settle()
    expect(w.find('[data-testid="display-display-porch"]').exists()).toBe(true)
    expect(w.find('[data-testid="display-display-kitchen"]').exists()).toBe(false)
    w.unmount()
  })

  it('leaving one of several households goes back to the picker', async () => {
    api.myMemberships.mockResolvedValue([LAKE_ADULT, RIVERA_OWNER, BEACH_OWNER])
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Lake house Adult').trigger('click')
    await settle()
    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    api.myMemberships.mockResolvedValue([RIVERA_OWNER, BEACH_OWNER])
    await buttonByText(w, 'Leave Lake house').trigger('click')
    await settle()
    expect(api.leaveHousehold).toHaveBeenCalledWith(CLIENT, LAKE)
    expect(w.find('h1').text()).toBe('Which household?')
    expect(w.text()).toContain('You left Lake house.')
    expect(hasButton(w, 'Lake house Adult')).toBe(false)
    w.unmount()
  })

  it('tells an owner how to leave', async () => {
    const w = await mountPage()
    await signIn(w)
    expect(w.text()).toContain('Owners can’t leave from here.')
    w.unmount()
  })
})
