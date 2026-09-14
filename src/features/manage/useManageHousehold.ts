import { computed, markRaw, onScopeDispose, ref, shallowRef, type Ref } from 'vue'
import { isDemo } from '@/data/householdSource'
import { SettingsError, type AdultClient, type AdultMembershipRow, type MemberRow, type SettingsApi } from '@/data/settingsApi'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import type { AccountSectionHost, OwnerSectionHost, SectionHousehold } from '@/features/settings/sectionHosts'
import { signedInOwner } from '@/features/settings/useOwnerSignIn'
import { loadManageApi } from './manageApi'
import { initialSelection, isExpiredSession, isPermissionRefusal } from './manageModel'

/**
 * - `signIn`: the email-code sign-in (or, in demo, choosing a demo adult)
 * - `loading`: reading the adult's households
 * - `loadFailed`: that failed for a reason worth retrying
 * - `pick`: several households; the adult picks one
 * - `none`: the account belongs to no household
 * - `ready`: one household open
 */
export type ManagePhase = 'signIn' | 'loading' | 'loadFailed' | 'pick' | 'none' | 'ready'

export const SIGNED_OUT = 'You’re signed out.'
export const IDLE_SIGNED_OUT = 'Signed out after 5 minutes without a touch.'
export const SESSION_ENDED = 'Your sign-in ended. Sign in again.'

export interface ManageHouseholdOptions {
  /** The API to use (tests); otherwise `loadManageApi`. */
  api?: SettingsApi
  idleMs?: number
}

/** True while the browser reports a connection. */
function useOnline(): Ref<boolean> {
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  const update = () => (online.value = navigator.onLine !== false)
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })
  return online
}

function loadErrorMessage(e: unknown): string {
  if (e instanceof SettingsError && e.code === 'network') return 'Couldn’t reach Roost Family. Check the connection and try again.'
  return 'Couldn’t load your households. Try again.'
}

/**
 * Manage household (spec §7.10): a full sign-in in any browser on a temporary adult client that is never persisted,
 * ended after 5 minutes without a touch (spec §6.3), on Sign out, when it expires, and when the page goes away.
 * After sign-in it loads the adult's households, opens the only one or lets the adult pick, and builds the hosts the
 * Settings sections run in here: owners get the owner sections on this sign-in; adults get My account. Nothing here
 * reads the display's session or stores.
 */
export function useManageHousehold(options: ManageHouseholdOptions = {}) {
  let apiLoading: Promise<SettingsApi> | null = options.api ? Promise.resolve(options.api) : null
  function loadApi(): Promise<SettingsApi> {
    apiLoading ??= loadManageApi().catch((e: unknown) => {
      apiLoading = null
      throw e
    })
    return apiLoading
  }

  const phase = ref<ManagePhase>('signIn')
  const adult = shallowRef<AdultSession | null>(null)
  const memberships = shallowRef<AdultMembershipRow[]>([])
  const selected = shallowRef<AdultMembershipRow | null>(null)
  /** Loads and owner actions in flight; while any runs the page is busy and the idle sign-out waits. */
  const inFlight = ref(0)
  const busy = computed(() => inFlight.value > 0)
  /** Bumped on every sign-out, so work from an ended sign-in can't touch the next one's count. */
  let generation = 0
  const notice = ref<string | null>(null)
  const error = ref<string | null>(null)
  /** Bumped to give the sign-in form a fresh client after a sign-out. */
  const signInKey = ref(0)
  const online = useOnline()
  const offline = computed(() => !online.value)
  let stopAuthWatch: (() => void) | null = null
  // Stop listening to the client before the idle composable (registered below) ends the session on unmount.
  onScopeDispose(() => {
    stopAuthWatch?.()
    stopAuthWatch = null
  })

  /** Runs `work`, counting it as in flight for as long as it runs. */
  async function track<T>(work: () => Promise<T>): Promise<T> {
    const mine = generation
    inFlight.value += 1
    try {
      return await work()
    } finally {
      if (generation === mine) inFlight.value -= 1
    }
  }

  /** Back to the sign-in with `message`, without ending the session (the caller does, or already has). */
  function resetToSignIn(message: string | null): void {
    stopAuthWatch?.()
    stopAuthWatch = null
    adult.value = null
    memberships.value = []
    selected.value = null
    generation += 1
    inFlight.value = 0
    error.value = null
    notice.value = message
    signInKey.value += 1
    phase.value = 'signIn'
  }

  function signOut(message: string | null = SIGNED_OUT): void {
    const current = adult.value
    resetToSignIn(message)
    if (current) void current.end().catch(() => {})
  }

  function expire(): void {
    signOut(SESSION_ENDED)
  }

  useAdultSessionIdle({
    session: () => adult.value,
    busy: () => busy.value,
    onExpired: () => resetToSignIn(IDLE_SIGNED_OUT),
    idleMs: options.idleMs,
  })

  /** The client signing out on its own (its refresh token expired or was revoked) ends the page's sign-in too. */
  function watchAuth(session: AdultSession): void {
    const auth = (session.client as Partial<AdultClient>).auth
    if (!auth?.onAuthStateChange) return
    const { data } = auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && adult.value === session) queueMicrotask(expire)
    })
    stopAuthWatch = () => data.subscription.unsubscribe()
  }

  /** True when the client no longer holds a session (it signed out, or its refresh failed). */
  async function sessionMissing(session: AdultSession): Promise<boolean> {
    const auth = (session.client as Partial<AdultClient>).auth
    if (!auth?.getSession) return false
    try {
      const { data } = await auth.getSession()
      return data.session === null
    } catch {
      return false
    }
  }

  /** True (and back to sign-in) when `e` or the client says the sign-in has ended. */
  async function expiredBy(session: AdultSession, e: unknown): Promise<boolean> {
    if (!isExpiredSession(e) && !(await sessionMissing(session))) return false
    if (adult.value === session) expire()
    return true
  }

  function readMemberships(session: AdultSession): Promise<AdultMembershipRow[]> {
    return track(async () => (await loadApi()).myMemberships(session.client, session.userId))
  }

  function show(rows: AdultMembershipRow[], next: AdultMembershipRow | null, message: string | null): void {
    memberships.value = rows
    notice.value = message
    selected.value = next
    phase.value = next ? 'ready' : rows.length === 0 ? 'none' : 'pick'
  }

  async function loadMemberships(keepMembershipId: string | null, message: string | null = null): Promise<void> {
    const session = adult.value
    if (!session) return
    phase.value = 'loading'
    error.value = null
    try {
      const rows = await readMemberships(session)
      if (adult.value !== session) return
      show(rows, initialSelection(rows, keepMembershipId), message)
    } catch (e) {
      if (adult.value !== session || (await expiredBy(session, e))) return
      error.value = loadErrorMessage(e)
      phase.value = 'loadFailed'
    }
  }

  /**
   * An action was refused: the adult may have been made an adult or removed elsewhere while this page was open.
   * Reads the memberships again and, if this one's role changed or it's gone, shows the household for the new role
   * (or the picker, or No households). An unchanged role leaves the refusal where the section shows it.
   */
  async function recheckAccess(session: AdultSession, row: AdultMembershipRow): Promise<void> {
    let rows: AdultMembershipRow[]
    try {
      rows = await readMemberships(session)
    } catch (e) {
      if (adult.value === session) await expiredBy(session, e)
      return
    }
    if (adult.value !== session || selected.value?.membershipId !== row.membershipId) return
    const now = rows.find((m) => m.membershipId === row.membershipId)
    if (now && now.role === row.role) return
    show(rows, now ?? initialSelection(rows), `Your access to ${row.householdName} changed.`)
  }

  /** After a failed owner or My account action: an ended sign-in goes back to sign-in; a refusal rechecks access. */
  async function afterActionFailed(session: AdultSession, row: AdultMembershipRow, e: unknown): Promise<void> {
    if (adult.value !== session || (await expiredBy(session, e))) return
    if (isPermissionRefusal(e)) await recheckAccess(session, row)
  }

  async function onSignedIn(session: AdultSession): Promise<void> {
    adult.value = session
    notice.value = null
    watchAuth(session)
    await loadMemberships(null)
  }

  /** Demo mode has no accounts: sign in as one of the demo adults (their membership id stands in for a user id). */
  async function demoAdults(): Promise<MemberRow[]> {
    const api = await loadApi()
    return api.listMembers(markRaw({}) as AdultClient, '')
  }

  function demoSignIn(membershipId: string): Promise<void> {
    return onSignedIn({ client: markRaw({}) as AdultClient, userId: membershipId, email: '', end: async () => {} })
  }

  function retry(): Promise<void> {
    return loadMemberships(selected.value?.membershipId ?? null)
  }

  function pick(row: AdultMembershipRow): void {
    notice.value = null
    selected.value = row
    phase.value = 'ready'
  }

  function switchHousehold(): void {
    notice.value = null
    selected.value = null
    phase.value = 'pick'
  }

  const household = computed<SectionHousehold | null>(() => {
    const row = selected.value
    return row ? { id: row.householdId, name: row.householdName, timeZone: row.timeZone } : null
  })

  const ownerHost = computed<OwnerSectionHost | null>(() => {
    const session = adult.value
    const row = selected.value
    if (!session || !row || row.role !== 'owner') return null
    const gate = signedInOwner(
      { client: session.client, membershipId: row.membershipId, userId: session.userId },
      {
        demo: isDemo,
        busy,
        signOut,
        run: async (action) => {
          try {
            return await track(action)
          } catch (e) {
            await afterActionFailed(session, row, e)
            throw e
          }
        },
      },
    )
    return {
      surface: 'browser',
      household,
      offline,
      loadApi,
      gate,
      thisDisplayId: computed(() => null),
      canManageRoles: false,
      canAddAdults: false,
      handOffToNewAdult: async () => {},
      afterMemberRemoved: () => false,
      afterDisplayRenamed: () => {},
      afterThisDisplayRemoved: async () => {},
      afterHouseholdDeleted: () => loadMemberships(null, `${row.householdName} was deleted.`),
    }
  })

  const accountHost = computed<AccountSectionHost | null>(() => {
    const session = adult.value
    const row = selected.value
    if (!session || !row) return null
    return {
      surface: 'browser',
      household,
      offline,
      loadApi,
      me: computed(() => ({ membershipId: row.membershipId, displayName: row.displayName })),
      lastOwner: computed(() => false),
      signedIn: { client: session.client, membershipId: row.membershipId },
      pinSession: null,
      holdsNight: false,
      afterLeft: () => void loadMemberships(null, `You left ${row.householdName}.`),
      onActionError: (e) => void afterActionFailed(session, row, e),
    }
  })

  return {
    demo: isDemo,
    phase,
    adult,
    memberships,
    selected,
    busy,
    notice,
    error,
    signInKey,
    offline,
    ownerHost,
    accountHost,
    onSignedIn,
    demoAdults,
    demoSignIn,
    retry,
    pick,
    switchHousehold,
    signOut,
  }
}
