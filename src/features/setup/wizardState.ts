import { reactive } from 'vue'
import type { AdultSession } from '@/session/adultSession'
import { PERSON_COLORS } from '@/ui/personPalette'

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
    busy: false,
    error: null as string | null,
  })
}

export type WizardState = ReturnType<typeof createWizardState>

export function nextStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)]!
}

export function previousStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step)
  return SETUP_STEPS[Math.max(i - 1, 0)]!
}
