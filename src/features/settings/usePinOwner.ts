import { computed, ref, type Ref } from 'vue'
import { isDemo } from '@/data/householdSource'
import { SettingsError, type SettingsApi, type SettingsAuth } from '@/data/settingsApi'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import type { OwnerActions, OwnerGate, SectionHousehold } from './sectionHosts'
import { loadSettingsApi } from './settingsApiLoader'
import type { OwnerSignInPhase } from './useOwnerSignIn'

/**
 * The owner actions of Settings on a display, authorised by the Settings PIN session (spec §6.3, §7.9).
 *
 * The adult typed their PIN to open Settings, so there is no second sign-in: Members, Displays and Delete
 * household act straight away, like Children or Medicines. Every call resends the membership and PIN and the
 * server checks both again (and that the membership is an owner of this live household), so nothing here is
 * trusted — this only decides what the tablet offers. An adult who is not an owner sees the owner-only message
 * instead of buttons; `signOut` is how a section gives up that authority after the adult stops being an owner.
 */
export function usePinOwner(household: Readonly<Ref<SectionHousehold | null>>): { gate: OwnerGate; act: OwnerActions } {
  const session = useSettingsSessionStore()
  /** Set once the adult has given up ownership in this session, so the section stops offering owner actions. */
  const steppedDown = ref(false)
  const notice = ref<string | null>(null)
  const busy = ref(false)

  const ready = computed(() => session.isOwner && !steppedDown.value)
  const phase = computed<OwnerSignInPhase>(() => (ready.value ? 'ready' : 'notOwner'))
  const membershipId = computed(() => (ready.value ? session.info?.membershipId ?? null : null))

  const gate: OwnerGate = {
    demo: isDemo,
    phase,
    membershipId,
    busy,
    notice,
    signOut(message = null) {
      notice.value = message
      steppedDown.value = true
    },
    signIn: null,
  }

  /** The open session's credentials. A session that ended under the adult (idle, Night Mode) reads as an auth
   *  failure, which the section shows like any other refusal; Settings itself is already closing. */
  function auth(): SettingsAuth {
    const open = session.auth
    if (open === null) throw new SettingsError('Settings is no longer open', 'auth')
    return open
  }

  function householdId(): string {
    const id = household.value?.id
    if (id === undefined) throw new SettingsError('This household is not loaded', 'other')
    return id
  }

  /** Runs one owner action, marking the section busy while it is in flight. */
  async function run<T>(action: (api: SettingsApi, pin: SettingsAuth) => Promise<T>): Promise<T> {
    const pin = auth()
    const api = await loadSettingsApi()
    busy.value = true
    try {
      return await action(api, pin)
    } finally {
      busy.value = false
    }
  }

  const act: OwnerActions = {
    listMembers: () => run((api) => api.listHouseholdMembers(householdId())),
    setMemberRole: (id, role) => run((api, pin) => api.setMemberRolePin(pin, id, role)),
    removeMember: (id) => run((api, pin) => api.removeMemberPin(pin, id)),
    createMemberInvite: (role) => run((api, pin) => api.createMemberInvitePin(pin, role)),
    listDisplays: () => run((api) => api.listHouseholdDisplays(householdId())),
    renameDisplay: (id, name) => run((api, pin) => api.renameDisplayPin(pin, id, name)),
    revokeDisplay: (id) => run((api, pin) => api.revokeDisplayPin(pin, id)),
    signOutThisDisplay: () => run((api, pin) => api.signOutDisplayPin(pin)),
    deleteHousehold: (confirmName) => run((api, pin) => api.deleteHouseholdPin(pin, confirmName)),
  }

  return { gate, act }
}
