import { reactive } from 'vue'
import type { AdultSession } from '@/session/adultSession'
import { PERSON_COLORS } from '@/ui/personPalette'
import type { PendingDisplayClaim } from './completeSetup'

export const POLICY_VERSION = '2026-09-14'

export const SETUP_STEPS = ['welcome', 'invite', 'signIn', 'consent', 'household', 'kids', 'you', 'display'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

export interface KidDraft {
  name: string
  birthday: string
  color: string
}

export function createWizardState() {
  return reactive({
    step: 'welcome' as SetupStep,
    inviteCode: '',
    email: '',
    adult: null as AdultSession | null,
    householdName: '',
    zip: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lat: null as number | null,
    lon: null as number | null,
    kids: [] as KidDraft[],
    displayName: '',
    color: PERSON_COLORS[0] as string,
    pin: '',
    displayLabel: 'Kitchen',
    /** Set once setup_household succeeds, so a retry never creates a second household. */
    householdId: null as string | null,
    /** Set once this tablet is registered, so a retry reuses the claim token until it expires. */
    displayClaim: null as PendingDisplayClaim | null,
    busy: false,
    error: null as string | null,
  })
}

export type WizardState = ReturnType<typeof createWizardState>

/** Invite → Consent skips Sign in while an adult is already signed in (after going Back past it). */
export function nextStep(step: SetupStep, opts: { signedIn?: boolean } = {}): SetupStep {
  if (step === 'invite' && opts.signedIn) return 'consent'
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)]!
}

/** Back from Consent skips Sign in while an adult is already signed in. */
export function previousStep(step: SetupStep, opts: { signedIn?: boolean } = {}): SetupStep {
  if (step === 'consent' && opts.signedIn) return 'invite'
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.max(i - 1, 0)]!
}
