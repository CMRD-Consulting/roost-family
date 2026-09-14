import { markRaw, ref, shallowRef } from 'vue'
import { isDemo } from '@/data/householdSource'
import { SettingsError, type AdultClient } from '@/data/settingsApi'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import { loadSettingsApi } from './settingsApiLoader'
import { settingsErrorMessage } from './settingsErrors'
import { useNightHold } from './useNightHold'

/** A signed-in owner of this household, for the Members, Displays and Delete household sections. */
export interface SignedInOwner {
  client: AdultClient
  membershipId: string
  userId: string
}

export type OwnerSignInPhase = 'idle' | 'signIn' | 'checking' | 'notOwner' | 'ready'

/** Demo mode has no accounts: the demo API ignores the client for the few owner actions it supports. */
const DEMO_CLIENT = markRaw({}) as AdultClient

/** Wording for a failed owner action: a refused sign-in is not a PIN problem, and demo refusals say so. */
export function ownerActionMessage(e: unknown): string {
  if (e instanceof SettingsError && e.code === 'auth') return 'Roost Family didn’t accept that sign-in. Sign in again.'
  if (e instanceof SettingsError && e.message === 'Not available in demo') return 'Not available in demo.'
  return settingsErrorMessage(e)
}

/**
 * The full owner sign-in the sensitive Settings sections require (spec §6.3, §7.9): an email-code sign-in on a
 * temporary adult client, accepted only when that account is an owner of this household. The session ends after
 * 5 minutes without a touch, on `signOut`, or when the section using this closes. In demo mode there are no
 * accounts: the PIN session's owner stands in, and only the actions the demo API supports work.
 */
export function useOwnerSignIn() {
  const store = useHouseholdStore()
  const session = useSettingsSessionStore()

  const demoOwner: SignedInOwner | null =
    isDemo && session.isOwner && session.info ? { client: DEMO_CLIENT, membershipId: session.info.membershipId, userId: 'demo' } : null

  const phase = ref<OwnerSignInPhase>(isDemo ? (demoOwner ? 'ready' : 'notOwner') : 'signIn')
  const owner = shallowRef<SignedInOwner | null>(demoOwner)
  const adult = shallowRef<AdultSession | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  /** Bumped to give the sign-in form a fresh client (after a refused account or an ended session). */
  const signInKey = ref(0)
  // Night Mode waits while an owner is signed in (the sign-in form holds it itself while it's showing).
  useNightHold(() => adult.value !== null)

  function endAdult(): void {
    const current = adult.value
    adult.value = null
    owner.value = null
    if (current) void current.end().catch(() => {})
  }

  useAdultSessionIdle({
    session: () => adult.value,
    busy: () => busy.value,
    onExpired: () => {
      adult.value = null
      owner.value = null
      phase.value = 'idle'
      notice.value = 'Signed out after 5 minutes without a touch.'
    },
  })

  function startSignIn(): void {
    if (isDemo) return
    endAdult()
    error.value = null
    notice.value = null
    signInKey.value += 1
    phase.value = 'signIn'
  }

  function cancelSignIn(): void {
    if (isDemo) return
    endAdult()
    error.value = null
    phase.value = 'idle'
  }

  async function onSignedIn(signedIn: AdultSession): Promise<void> {
    adult.value = signedIn
    const householdId = store.view?.household.id
    if (!householdId) return cancelSignIn()
    phase.value = 'checking'
    error.value = null
    notice.value = null
    busy.value = true
    try {
      const api = await loadSettingsApi()
      const membership = await api.adultMembership(signedIn.client, householdId, signedIn.userId)
      if (adult.value !== signedIn) return
      if (membership?.role !== 'owner') {
        endAdult()
        phase.value = 'notOwner'
        return
      }
      owner.value = { client: signedIn.client, membershipId: membership.membershipId, userId: signedIn.userId }
      phase.value = 'ready'
    } catch (e) {
      endAdult()
      error.value = ownerActionMessage(e)
      phase.value = 'idle'
    } finally {
      busy.value = false
    }
  }

  /** Ends the owner's sign-in (e.g. handing the tablet to a new adult, or after they gave up ownership). */
  function signOut(message: string | null = null): void {
    if (isDemo) return
    endAdult()
    error.value = null
    notice.value = message
    phase.value = 'idle'
  }

  /** Runs an owner action, holding off the idle sign-out while it's in flight. */
  async function run<T>(action: (owner: SignedInOwner) => Promise<T>): Promise<T> {
    const current = owner.value
    if (!current) throw new SettingsError('Sign in as an owner first', 'auth')
    busy.value = true
    try {
      return await action(current)
    } finally {
      busy.value = false
    }
  }

  return { demo: isDemo, phase, owner, busy, error, notice, signInKey, startSignIn, cancelSignIn, onSignedIn, signOut, run }
}

export type OwnerSignIn = ReturnType<typeof useOwnerSignIn>
