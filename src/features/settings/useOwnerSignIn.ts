import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { SettingsError, type AdultClient } from '@/data/settingsApi'
import { settingsErrorMessage } from './settingsErrors'

/** A signed-in owner of this household, for the Members, Displays and Delete household sections. */
export interface SignedInOwner {
  client: AdultClient
  membershipId: string
  userId: string
}

/**
 * Whether the owner-only sections can act. On a display the Settings PIN session decides (`usePinOwner`); in a
 * browser at /manage the adult is already signed in, so it is always `ready`.
 */
export type OwnerSignInPhase = 'notOwner' | 'ready'

/** An owner's authority as the Members, Displays and Delete household sections use it. */
export interface OwnerSignIn {
  demo: boolean
  owner: ShallowRef<SignedInOwner | null>
  /** True while an owner action runs; the idle sign-out waits for it. */
  busy: Readonly<Ref<boolean>>
  /** Ends the owner's sign-in, optionally saying why. */
  signOut: (message?: string | null) => void
  /** Runs an owner action, holding off the idle sign-out while it's in flight. */
  run: <T>(action: (owner: SignedInOwner) => Promise<T>) => Promise<T>
}

/** Wording for a failed owner action: a refused sign-in is not a PIN problem, and demo refusals say so. */
export function ownerActionMessage(e: unknown): string {
  if (e instanceof SettingsError && e.code === 'auth') return 'Roost Family didn’t accept that sign-in. Sign in again.'
  if (e instanceof SettingsError && e.message === 'Not available in demo') return 'Not available in demo.'
  return settingsErrorMessage(e)
}

/**
 * The owner's authority in a browser at /manage, where they signed in with an email code to reach the page:
 * there is no second sign-in to make, so the sections act through this straight away (spec §6.3, §7.10).
 * On a display, `usePinOwner` provides the same shape from the Settings PIN session instead.
 */
export function signedInOwner(
  signedIn: SignedInOwner,
  options: {
    demo: boolean
    busy: Readonly<Ref<boolean>>
    run: <T>(action: () => Promise<T>) => Promise<T>
    signOut: (message: string | null) => void
  },
): OwnerSignIn {
  const owner = shallowRef<SignedInOwner | null>(signedIn)
  return {
    demo: options.demo,
    owner,
    busy: options.busy,
    signOut: (message = null) => options.signOut(message),
    run: (action) => options.run(() => action(signedIn)),
  }
}
