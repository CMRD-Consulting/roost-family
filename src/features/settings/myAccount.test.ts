import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { CalendarError } from '@/data/calendarApi'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import { useHouseholdStore } from '@/stores/householdStore'
import { useModesStore } from '@/stores/modesStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { PERSON_COLORS } from '@/ui/personPalette'
import AdultSignIn from './AdultSignIn.vue'
import MyAccountSection from './sections/MyAccountSection.vue'
import { resetSettingsApiLoaderForTests } from './settingsApiLoader'

const api = vi.hoisted(() => ({ current: null as unknown }))
const adult = vi.hoisted(() => ({
  newAdultClient: vi.fn(() => ({ name: 'adult-client' })),
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  disposeAdultClient: vi.fn(),
}))

vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/session/adultSession', () => adult)
const calendars = vi.hoisted(() => ({
  listMyConnections: vi.fn(async () => []),
  listPeople: vi.fn(async () => []),
}))
vi.mock('@/data/calendarApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/calendarApi')>()),
  createCalendarSettingsApi: () => calendars,
  loadCalendarClient: async () => ({ name: 'display-client' }),
}))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX = 'bbbbbbbb-0000-0000-0000-000000000002'

type Fake = SettingsApi & Record<'settingsVerify' | 'setMyColor' | 'setMyPin' | 'leaveHousehold' | 'adultMembership', ReturnType<typeof vi.fn>>

function fakeApi(): Fake {
  return {
    settingsVerify: vi.fn(async ({ membershipId }: { membershipId: string }) =>
      membershipId === SAM ? { role: 'owner', displayName: 'Sam' } : { role: 'adult', displayName: 'Alex' }),
    setMyColor: vi.fn().mockResolvedValue(undefined),
    setMyPin: vi.fn().mockResolvedValue(undefined),
    leaveHousehold: vi.fn().mockResolvedValue(undefined),
    adultMembership: vi.fn(),
  } as never
}

let settingsApi: Fake
const endSession = vi.fn().mockResolvedValue(undefined)

async function settle() {
  await vi.advanceTimersByTimeAsync(50)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function buttonByText(w: VueWrapper, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

function inputByLabel(w: VueWrapper, label: string) {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No label "${label}"`)
  return w.find(`#${CSS.escape(lab.attributes('for')!)}`)
}

async function mountAs(membershipId: string, pin: string): Promise<VueWrapper> {
  const session = useSettingsSessionStore()
  session.init(settingsApi)
  await session.enter(membershipId, pin)
  const w = mount(MyAccountSection, { attachTo: document.body })
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
  setActivePinia(createPinia())
  useHouseholdStore().snapshot = buildDemoSnapshot(new Date())
  settingsApi = fakeApi()
  api.current = settingsApi
  endSession.mockClear()
  adult.newAdultClient.mockClear()
  adult.sendEmailCode.mockReset().mockResolvedValue(undefined)
  adult.disposeAdultClient.mockReset().mockResolvedValue(undefined)
  adult.verifyEmailCode.mockReset().mockImplementation(async (client: unknown, email: string) => ({
    client, userId: 'user-1', email, end: endSession,
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  resetSettingsApiLoaderForTests()
  vi.useRealTimers()
})

describe('AdultSignIn', () => {
  it('emails a code, verifies it and hands over the session', async () => {
    const w = mount(AdultSignIn, { props: { title: 'Sign in' } })
    await buttonByText(w, 'Email me a 6-digit code').trigger('click')
    expect(w.find('[role="alert"]').text()).toBe('Enter a valid email address.')
    expect(adult.sendEmailCode).not.toHaveBeenCalled()

    await signIn(w, ' sam@example.com ')

    expect(adult.sendEmailCode).toHaveBeenCalledWith({ name: 'adult-client' }, 'sam@example.com')
    expect(adult.verifyEmailCode).toHaveBeenCalledWith({ name: 'adult-client' }, 'sam@example.com', '123456')
    expect(w.emitted('signedIn')![0]![0]).toMatchObject({ userId: 'user-1', email: 'sam@example.com' })
    w.unmount()
    expect(adult.disposeAdultClient).not.toHaveBeenCalled()
  })

  it('moves focus to its heading when the step changes', async () => {
    const w = mount(AdultSignIn, { props: { title: 'Sign in as an owner' }, attachTo: document.body })
    const heading = w.find('[data-step-heading]')
    expect(heading.text()).toBe('Sign in as an owner')
    expect(heading.attributes('tabindex')).toBe('-1')

    await inputByLabel(w, 'Email').setValue('sam@example.com')
    await buttonByText(w, 'Email me a 6-digit code').trigger('click')
    await settle()
    expect(w.text()).toContain('We sent a code to')
    expect(document.activeElement).toBe(heading.element)

    ;(document.activeElement as HTMLElement).blur()
    await buttonByText(w, 'Use a different email').trigger('click')
    await settle()
    expect(document.activeElement).toBe(w.find('[data-step-heading]').element)
    w.unmount()
  })

  it('shows a failed code and disposes of the unused client when it goes away', async () => {
    adult.verifyEmailCode.mockRejectedValue(new Error('Token has expired or is invalid'))
    const w = mount(AdultSignIn)
    await signIn(w)
    expect(w.find('[role="alert"]').text()).toBe('Token has expired or is invalid')
    expect(w.emitted('signedIn')).toBeUndefined()
    w.unmount()
    expect(adult.disposeAdultClient).toHaveBeenCalledWith({ name: 'adult-client' })
  })
})

describe('MyAccountSection', () => {
  it('saves my color', async () => {
    const w = await mountAs(SAM, '1234')
    const radios = w.find('[role="radiogroup"][aria-label="My color"]').findAll('[role="radio"]')
    await radios[3]!.trigger('click')
    await buttonByText(w, 'Save').trigger('click')
    await settle()
    expect(settingsApi.setMyColor).toHaveBeenCalledWith({ membershipId: SAM, pin: '1234' }, PERSON_COLORS[3])
    w.unmount()
  })

  it('changes my PIN after a full sign-in, then keeps Settings open with the new PIN', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: SAM, role: 'owner' })
    const w = await mountAs(SAM, '1234')

    await buttonByText(w, 'Change my PIN').trigger('click')
    await settle()
    expect(w.text()).toContain('Sign in as Sam to change your PIN')
    await signIn(w)

    expect(settingsApi.adultMembership).toHaveBeenCalledWith({ name: 'adult-client' }, HOUSEHOLD, 'user-1')
    await inputByLabel(w, 'New PIN').setValue('4321')
    await inputByLabel(w, 'New PIN again').setValue('4312')
    await buttonByText(w, 'Save new PIN').trigger('click')
    await settle()
    expect(w.text()).toContain('The two PINs don’t match.')
    expect(settingsApi.setMyPin).not.toHaveBeenCalled()

    await inputByLabel(w, 'New PIN again').setValue('4321')
    await buttonByText(w, 'Save new PIN').trigger('click')
    await settle()

    expect(settingsApi.setMyPin).toHaveBeenCalledWith({ name: 'adult-client' }, HOUSEHOLD, '4321')
    expect(endSession).toHaveBeenCalled()
    expect(useSettingsSessionStore().auth).toEqual({ membershipId: SAM, pin: '4321' })
    expect(w.text()).toContain('Your PIN is changed.')
    w.unmount()
  })

  it('shows my calendars straight away on the Settings PIN, with no sign-in and no Google or Microsoft', async () => {
    const w = await mountAs(SAM, '1234')

    const section = w.get('[data-testid="calendars-section"]')
    expect(section.get('h3').text()).toBe('Calendars')
    // The display's own client, and the PIN session — never an adult sign-in.
    expect(calendars.listMyConnections).toHaveBeenCalledWith({ name: 'display-client' }, HOUSEHOLD, SAM)
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Manage my calendars')
    expect(section.get('[data-testid="connect-google"]').attributes('disabled')).toBeDefined()
    expect(section.text()).toContain('roost.cmrd.dev/manage')
    w.unmount()
  })

  it('shows and assigns a calendar with the Settings PIN, and words a refused PIN', async () => {
    const setSelectionWithPin = vi.fn().mockResolvedValue(undefined)
    Object.assign(calendars, {
      listMyConnections: vi.fn(async () => [
        {
          id: 'conn-1', provider: 'ics', label: 'Family', status: 'ok',
          calendars: [{ id: 'sel-1', name: 'Family', visible: false, gone: false, assignee: { type: 'member', id: SAM } }],
        },
      ]),
      listPeople: vi.fn(async () => [{ type: 'member', id: SAM, name: 'Sam', color: PERSON_COLORS[0] }]),
      setSelectionWithPin,
    })
    const w = await mountAs(SAM, '1234')

    await w.get('[data-testid="visible-sel-1"]').trigger('click')
    await settle()
    expect(setSelectionWithPin).toHaveBeenCalledWith(
      { name: 'display-client' }, { membershipId: SAM, pin: '1234' }, 'sel-1', true, { type: 'member', id: SAM },
    )
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(false)

    setSelectionWithPin.mockRejectedValue(new CalendarError('forbidden'))
    await w.get('[data-testid="visible-sel-1"]').trigger('click')
    await settle()
    expect(w.get('[data-testid="calendars-section"] [role="alert"]').text())
      .toBe('Roost Family didn’t accept your PIN. Close Settings and open it again.')

    Object.assign(calendars, { listMyConnections: vi.fn(async () => []), listPeople: vi.fn(async () => []) })
    delete (calendars as Record<string, unknown>).setSelectionWithPin
    w.unmount()
  })

  it('holds Night Mode off while the full sign-in is open', async () => {
    const store = useHouseholdStore()
    store.snapshot = { ...store.snapshot!, household: { ...store.snapshot!.household, nightMode: { start: '14:00', end: '16:00' } } }
    const modes = useModesStore()
    const w = await mountAs(SAM, '1234')
    expect(modes.nightActive).toBe(true)
    await buttonByText(w, 'Change my PIN').trigger('click')
    await settle()
    expect(w.find('[data-testid="adult-sign-in"]').exists()).toBe(true)
    expect(modes.nightActive).toBe(false)
    w.unmount()
    expect(modes.nightActive).toBe(true)
  })

  it("refuses a sign-in that isn't the Settings adult's account", async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: ALEX, role: 'adult' })
    const w = await mountAs(SAM, '1234')

    await buttonByText(w, 'Change my PIN').trigger('click')
    await settle()
    await signIn(w, 'alex@example.com')

    expect(w.find('[role="alert"]').text()).toBe('That account isn’t Sam’s. Sign in with Sam’s email.')
    expect(endSession).toHaveBeenCalled()
    expect(w.text()).not.toContain('New PIN')
    w.unmount()
  })

  it('ends the adult sign-in after 5 minutes without a touch', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: SAM, role: 'owner' })
    const w = await mountAs(SAM, '1234')
    await buttonByText(w, 'Change my PIN').trigger('click')
    await settle()
    await signIn(w)
    expect(w.text()).toContain('New PIN')

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await settle()

    expect(endSession).toHaveBeenCalled()
    expect(w.text()).not.toContain('New PIN again')
    w.unmount()
  })

  it('holds off the idle sign-out of an open full sign-in while a calendar change is still saving', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: SAM, role: 'owner' })
    let finish!: () => void
    const connectIcsWithPin = vi.fn(() => new Promise((resolve) => (finish = () => resolve({ connectionId: 'c', selectionId: 's', name: 'Family', alreadyConnected: false }))))
    Object.assign(calendars, { connectIcsWithPin })
    const w = await mountAs(SAM, '1234')
    // Changing the PIN signs in as the adult; a calendar change saving at the same time holds that sign-in open.
    await buttonByText(w, 'Change my PIN').trigger('click')
    await settle()
    await signIn(w)
    await w.get('[data-testid="calendars-section"] input[type="url"]').setValue('https://example.com/family.ics')
    await w.get('[data-testid="calendars-section"] form').trigger('submit')
    await settle()
    expect(connectIcsWithPin).toHaveBeenCalledWith(
      { name: 'display-client' }, HOUSEHOLD, { membershipId: SAM, pin: '1234' }, 'https://example.com/family.ics',
    )
    // Restart the Settings PIN session's own 5-minute idle a little later than the adult's, so only the adult's
    // idle expiry falls in the window below.
    await vi.advanceTimersByTimeAsync(1_000)
    await useSettingsSessionStore().enter(SAM, '1234')

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 900)
    await flushPromises()
    expect(endSession).not.toHaveBeenCalled()
    expect(w.find('[data-testid="calendars-section"]').exists()).toBe(true)

    finish()
    await settle()
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
    await settle()
    expect(endSession).toHaveBeenCalled()
    delete (calendars as Record<string, unknown>).connectIcsWithPin
    w.unmount()
  })

  it('the only owner cannot leave, and is told why', async () => {
    const w = await mountAs(SAM, '1234')
    expect(buttonByText(w, 'Leave household').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('You’re the only owner.')
    w.unmount()
  })

  it('leaves the household after a full sign-in and confirmation, ending Settings', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: ALEX, role: 'adult' })
    const w = await mountAs(ALEX, '5678')

    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    await signIn(w, 'alex@example.com')
    expect(w.text()).toContain('Leave Rivera?')
    expect(settingsApi.leaveHousehold).not.toHaveBeenCalled()

    await buttonByText(w, 'Leave Rivera').trigger('click')
    await settle()

    expect(settingsApi.leaveHousehold).toHaveBeenCalledWith({ name: 'adult-client' }, HOUSEHOLD)
    expect(endSession).toHaveBeenCalled()
    expect(useSettingsSessionStore().info).toBeNull()
    w.unmount()
  })

  it('shows the server refusing to let someone leave', async () => {
    settingsApi.adultMembership.mockResolvedValue({ membershipId: ALEX, role: 'adult' })
    settingsApi.leaveHousehold.mockRejectedValue(new SettingsError('a household needs at least one owner', 'invalid'))
    const w = await mountAs(ALEX, '5678')

    await buttonByText(w, 'Leave household').trigger('click')
    await settle()
    await signIn(w, 'alex@example.com')
    await buttonByText(w, 'Leave Rivera').trigger('click')
    await settle()

    expect(w.find('[role="alert"]').text()).toBe('A household needs at least one owner.')
    expect(useSettingsSessionStore().info).not.toBeNull()
    w.unmount()
  })
})
