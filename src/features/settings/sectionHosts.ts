/**
 * Where the owner-only sections (Members, Displays, Delete household, My account) are shown, and what that place
 * does around them. Settings on a display (the default) builds a host from the display's own stores: the adult
 * PIN that opened Settings authorises every action (spec §6.3), the host knows which display it runs on, and it
 * hands the tablet over or leaves Settings when an action calls for it. Manage household (spec §7.10) passes a
 * host of its own: an adult already signed in with an email code on a temporary client, in a browser that is not
 * a display, with no Settings PIN session and no display stores.
 */
import { computed, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AdultClient, DisplayRow, MemberRow, SettingsApi, SettingsAuth } from '@/data/settingsApi'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { isLastOwner } from './myAccountForm'
import { setPendingInvite, type PendingInvite } from './pendingInvite'
import { loadSettingsApi } from './settingsApiLoader'
import { usePinOwner } from './usePinOwner'
import type { OwnerSignIn, OwnerSignInPhase } from './useOwnerSignIn'
import { useSettingsOffline } from './useSettingsSave'

export interface SectionHousehold {
  id: string
  name: string
  timeZone: string
}

/** Shared by both hosts: the household shown, whether saving is impossible now, and the API to save with. */
interface SectionHostBase {
  /** 'display': Settings on a registered tablet. 'browser': Manage household on any device. */
  surface: 'display' | 'browser'
  household: Readonly<Ref<SectionHousehold | null>>
  offline: Readonly<Ref<boolean>>
  loadApi: () => Promise<SettingsApi>
}

/**
 * Whether an owner section may act, however its host authenticates the adult. On a display that is decided by
 * the Settings PIN session's role; in a browser by the email sign-in, whose steps the extra phases describe.
 */
export interface OwnerGate {
  demo: boolean
  /** 'ready' = act now. 'notOwner' = this adult is not an owner here. The rest are browser sign-in steps. */
  phase: Readonly<Ref<OwnerSignInPhase>>
  /** The acting adult's membership, once ready; null otherwise. */
  membershipId: Readonly<Ref<string | null>>
  /** True while an owner action runs. */
  busy: Readonly<Ref<boolean>>
  /** Why the section stopped offering owner actions (e.g. the owner just made themself an adult). */
  notice: Readonly<Ref<string | null>>
  /** Gives up the owner authority this section had, optionally saying why. */
  signOut: (message?: string | null) => void
  /** The email sign-in a browser puts in front of the section, or null on a display, where the PIN is enough. */
  signIn: OwnerSignIn | null
}

/** The owner actions a section performs, already bound to how its host authenticates them. */
export interface OwnerActions {
  listMembers: () => Promise<MemberRow[]>
  setMemberRole: (membershipId: string, role: 'owner' | 'adult') => Promise<void>
  removeMember: (membershipId: string) => Promise<void>
  createMemberInvite: (role: 'owner' | 'adult') => Promise<{ token: string; expiresAt: string }>
  listDisplays: () => Promise<DisplayRow[]>
  renameDisplay: (displayId: string, name: string) => Promise<void>
  revokeDisplay: (displayId: string) => Promise<void>
  /** Only on a display: signs out the tablet the section runs on. A browser is not a display, so it has none. */
  signOutThisDisplay?: () => Promise<void>
  deleteHousehold: (confirmName: string) => Promise<void>
}

export interface OwnerSectionHost extends SectionHostBase {
  gate: OwnerGate
  act: OwnerActions
  /** The display this runs on; null in a browser. */
  thisDisplayId: Readonly<Ref<string | null>>
  /** Role changes and Add adult (the tablet hand-off, spec §6.4) are offered only on a display. */
  canManageRoles: boolean
  canAddAdults: boolean
  /** Add adult: the owner's part is done; hand the tablet to the new adult. */
  handOffToNewAdult: (invite: PendingInvite) => Promise<void>
  /** After removing a member. True when that closed the surface (the Settings adult removed themself). */
  afterMemberRemoved: (membershipId: string) => boolean
  afterDisplayRenamed: (displayId: string) => void
  /** After removing the display this runs on. */
  afterThisDisplayRemoved: () => Promise<void>
  /** After signing out the display this runs on: the tablet is back at "Set up / Join a household". */
  afterThisDisplaySignedOut: () => Promise<void>
  afterHouseholdDeleted: () => Promise<void>
}

/** An adult's full sign-in that is already open (Manage household), so My account needs no sign-in of its own. */
export interface SignedInAdult {
  client: AdultClient
  membershipId: string
}

export interface AccountSectionHost extends SectionHostBase {
  me: Readonly<Ref<{ membershipId: string; displayName: string } | null>>
  lastOwner: Readonly<Ref<boolean>>
  /** Null on a display, where each action asks for a sign-in of its own. */
  signedIn: SignedInAdult | null
  /** My color, my calendars and changing my PIN work through the Settings PIN session, so only on a display. */
  pinSession: {
    /** The open session's credentials, which authorise My calendars here (spec §6.3); null once it has ended. */
    auth: Readonly<Ref<SettingsAuth | null>>
    /** The PIN changed: reopen the Settings session with it. False when that failed and Settings closed. */
    afterPinChanged: (membershipId: string, pin: string) => Promise<boolean>
  } | null
  /** Holds Night Mode off while a sign-in or its action is open (display only). */
  holdsNight: boolean
  afterLeft: () => void
  /** A leave or PIN change failed (after the section shows the error): lets a browser end a sign-in that expired.
   *  Absent on a display. */
  onActionError?: (error: unknown) => void
}

/** Settings on a display: the Settings PIN authorises the owner actions, with no second sign-in (spec §6.3). */
export function useDisplayOwnerHost(): OwnerSectionHost {
  const store = useHouseholdStore()
  const display = useDisplayStore()
  const router = useRouter()
  const session = useSettingsSessionStore()
  const offline = useSettingsOffline()
  const household = computed(() => {
    const h = store.view?.household
    return h ? { id: h.id, name: h.name, timeZone: h.timeZone } : null
  })
  const { gate, act } = usePinOwner(household)

  return {
    surface: 'display',
    household,
    offline,
    loadApi: loadSettingsApi,
    gate,
    act,
    thisDisplayId: computed(() => display.identity?.displayId ?? null),
    canManageRoles: true,
    canAddAdults: true,
    async handOffToNewAdult(invite) {
      // The tablet goes to the new adult with nothing of Settings left open: the Settings PIN session ends and
      // the join flow runs full screen outside Settings. Navigate first, so the flow's Night Mode hold is in
      // place before the session (and with it this section) goes away.
      setPendingInvite(invite)
      await router.push('/join-adult')
      session.end()
    },
    afterMemberRemoved(membershipId) {
      // The adult who opened Settings was just removed: their PIN no longer works, so Settings closes.
      if (membershipId !== session.info?.membershipId) return false
      session.end()
      return true
    },
    afterDisplayRenamed(displayId) {
      // This tablet's own name shows elsewhere; pick the new one up now rather than at the next check-in.
      if (displayId === display.identity?.displayId && !gate.demo) void display.refresh()
    },
    async afterThisDisplayRemoved() {
      session.end()
      await display.markRemoved()
      await router.replace('/removed')
    },
    async afterThisDisplaySignedOut() {
      session.end()
      await display.markSignedOut()
      await router.replace('/setup')
    },
    async afterHouseholdDeleted() {
      session.end()
      await display.markRemoved()
      await router.replace('/removed')
    },
  }
}

/** Settings on a display: My account runs on the Settings PIN session and signs in per action. */
export function useDisplayAccountHost(): AccountSectionHost {
  const store = useHouseholdStore()
  const session = useSettingsSessionStore()
  const offline = useSettingsOffline()
  return {
    surface: 'display',
    household: computed(() => {
      const h = store.view?.household
      return h ? { id: h.id, name: h.name, timeZone: h.timeZone } : null
    }),
    offline,
    loadApi: loadSettingsApi,
    me: computed(() => {
      const info = session.info
      if (!info) return null
      const member = store.view?.members.find((m) => m.id === info.membershipId)
      return { membershipId: info.membershipId, displayName: info.displayName ?? member?.displayName ?? '' }
    }),
    lastOwner: computed(() => (store.view && session.info ? isLastOwner(store.view.members, session.info.membershipId) : false)),
    signedIn: null,
    pinSession: {
      auth: computed(() => session.auth),
      async afterPinChanged(membershipId, pin) {
        // The settings session holds the old PIN; reopen it with the new one so Settings keeps working.
        try {
          await session.enter(membershipId, pin)
          return true
        } catch {
          session.end()
          return false
        }
      },
    },
    holdsNight: true,
    afterLeft: () => session.end(),
  }
}
