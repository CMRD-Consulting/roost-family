/**
 * Where the full-sign-in sections (Members, Displays, Delete household, My account) are shown, and what that place
 * does around them. Settings on a display (the default) builds a host from the display's own stores: the section
 * signs an owner in itself, knows which display it runs on, and hands the tablet over or leaves Settings when an
 * action calls for it. Manage household (spec §7.10) passes a host of its own: an adult already signed in on a
 * temporary client, in a browser that is not a display, with no Settings PIN session and no display stores.
 */
import { computed, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AdultClient, SettingsApi } from '@/data/settingsApi'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { isLastOwner } from './myAccountForm'
import { setPendingInvite, type PendingInvite } from './pendingInvite'
import { loadSettingsApi } from './settingsApiLoader'
import { useOwnerSignIn, type OwnerSignIn } from './useOwnerSignIn'
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

export interface OwnerSectionHost extends SectionHostBase {
  gate: OwnerSignIn
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
  /** Changing my color and PIN work through the Settings PIN session, so only on a display. */
  pinSession: {
    /** The PIN changed: reopen the Settings session with it. False when that failed and Settings closed. */
    afterPinChanged: (membershipId: string, pin: string) => Promise<boolean>
  } | null
  /** Holds Night Mode off while a sign-in or its action is open (display only). */
  holdsNight: boolean
  afterLeft: () => void
}

/** Settings on a display: the owner signs in within the section. */
export function useDisplayOwnerHost(): OwnerSectionHost {
  const store = useHouseholdStore()
  const display = useDisplayStore()
  const router = useRouter()
  const session = useSettingsSessionStore()
  const offline = useSettingsOffline()
  const gate = useOwnerSignIn()
  const household = computed(() => {
    const h = store.view?.household
    return h ? { id: h.id, name: h.name, timeZone: h.timeZone } : null
  })

  return {
    surface: 'display',
    household,
    offline,
    loadApi: loadSettingsApi,
    gate,
    thisDisplayId: computed(() => display.identity?.displayId ?? null),
    canManageRoles: true,
    canAddAdults: true,
    async handOffToNewAdult(invite) {
      // The tablet goes to the new adult with nothing of Settings left open: the owner's sign-in and the Settings
      // PIN session both end, and the join flow runs full screen outside Settings. Navigate first: signing out
      // releases the owner's Night Mode hold, and the flow holds it from here on.
      setPendingInvite(invite)
      await router.push('/join-adult')
      gate.signOut()
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
      gate.signOut()
      await display.markRemoved()
      await router.replace('/removed')
    },
    async afterHouseholdDeleted() {
      gate.signOut()
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
