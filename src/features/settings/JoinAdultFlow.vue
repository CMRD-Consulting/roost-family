<script setup lang="ts">
/**
 * /join-adult (spec §6.4 "Add an adult"): the full-screen hand-off after an owner made an invite in Settings >
 * Members. By now the owner's sign-in and the Settings session have ended, so nothing of Settings is reachable
 * from here. The new adult signs in with their own email, agrees to the terms and health-data consent, and
 * chooses a name, color and PIN. Joining or cancelling signs them out and returns the tablet to the main screen,
 * as does 5 minutes without a touch. The invite is held in memory only (see pendingInvite).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHouseholdSession } from '@/features/main/useHouseholdSession'
import ConsentChecks from '@/features/setup/ConsentChecks.vue'
import { POLICY_VERSION } from '@/features/setup/wizardState'
import type { AdultSession } from '@/session/adultSession'
import { ADULT_SESSION_IDLE_MS, startIdleTimer } from '@/session/idleTimer'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import AdultSignIn from './AdultSignIn.vue'
import ColorPicker from './forms/ColorPicker.vue'
import { validateNewMember } from './ownerForms'
import { takePendingInvite } from './pendingInvite'
import { loadSettingsApi } from './settingsApiLoader'
import { ownerActionMessage } from './useOwnerSignIn'
import { useSettingsOffline } from './useSettingsSave'

type Step = 'handoff' | 'signIn' | 'consent' | 'details'

const router = useRouter()
const store = useHouseholdStore()
const offline = useSettingsOffline()
useHouseholdSession()

const invite = takePendingInvite()
const householdName = computed(() => store.view?.household.name ?? 'this household')
const usedColors = computed(() => new Set(store.view?.members.map((m) => m.color) ?? []))

const step = ref<Step>('handoff')
const newAdult = shallowRef<AdultSession | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const agreeTerms = ref(false)
const agreeHealth = ref(false)
const name = ref('')
const color = ref<string | null>(PERSON_COLORS.find((c) => !usedColors.value.has(c)) ?? PERSON_COLORS[0]!)
const pin = ref('')
const pinAgain = ref('')

let finished = false

// Each step (and the hand-off on arrival) moves focus to its heading, so a screen reader follows the flow.
const root = useTemplateRef<HTMLElement>('root')
async function focusStepHeading(): Promise<void> {
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-step-heading]')?.focus()
}
onMounted(focusStepHeading)
watch(step, focusStepHeading)

/** Signs the new adult out (if signed in) and returns the tablet to the main screen. */
function finish(): void {
  if (finished) return
  finished = true
  const current = newAdult.value
  newAdult.value = null
  if (current) void current.end().catch(() => {})
  void router.replace('/home')
}

if (invite === null) finish()

useAdultSessionIdle({
  session: () => newAdult.value,
  busy: () => busy.value,
  onExpired: () => {
    newAdult.value = null
    finish()
  },
})

// Before anyone has signed in there's no session to time out: the flow itself gives up after the same idle period.
let stopFlowIdle: (() => void) | null = null
watch(
  newAdult,
  (signedIn) => {
    stopFlowIdle?.()
    stopFlowIdle = signedIn || finished ? null : startIdleTimer(finish, ADULT_SESSION_IDLE_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  // Leaving by any other way (e.g. this display was removed): no navigation, but nothing stays signed in.
  finished = true
  stopFlowIdle?.()
  const current = newAdult.value
  newAdult.value = null
  if (current) void current.end().catch(() => {})
})

function onSignedIn(signedIn: AdultSession): void {
  if (finished) {
    void signedIn.end().catch(() => {})
    return
  }
  newAdult.value = signedIn
  error.value = null
  step.value = 'consent'
}

async function acceptConsent(): Promise<void> {
  const adult = newAdult.value
  if (!adult || !agreeTerms.value || !agreeHealth.value || busy.value || offline.value) return
  error.value = null
  busy.value = true
  try {
    const api = await loadSettingsApi()
    await api.recordConsent(adult.client, POLICY_VERSION)
    step.value = 'details'
  } catch (e) {
    error.value = ownerActionMessage(e)
  } finally {
    busy.value = false
  }
}

async function join(): Promise<void> {
  const adult = newAdult.value
  if (!adult || !invite || busy.value || offline.value) return
  error.value = validateNewMember({ name: name.value, color: color.value, pin: pin.value, pinAgain: pinAgain.value })
  if (error.value) return
  busy.value = true
  try {
    const api = await loadSettingsApi()
    await api.acceptMemberInvite(adult.client, { token: invite.token, displayName: name.value.trim(), color: color.value!, pin: pin.value })
  } catch (e) {
    error.value = ownerActionMessage(e)
    return
  } finally {
    busy.value = false
  }
  pin.value = ''
  pinAgain.value = ''
  finish()
}
</script>

<template>
  <main class="flex min-h-dvh justify-center overflow-y-auto bg-app px-10 py-12 text-ink" data-testid="join-adult-flow">
    <div v-if="invite" ref="root" class="flex w-full max-w-[720px] flex-col gap-5">
      <template v-if="step === 'handoff'">
        <h1 tabindex="-1" data-step-heading class="text-[32px] font-semibold text-ink outline-none">Hand the tablet to the new adult</h1>
        <p class="text-[20px] text-ink-2">
          They’ll sign in with their own email, agree to the terms, and choose a name, color and PIN to join
          {{ householdName }} as {{ invite.role === 'owner' ? 'an owner' : 'an adult' }}. The invite works for 10 minutes.
        </p>
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" @click="finish">Cancel</RButton>
          <RButton @click="step = 'signIn'">I’m the new adult</RButton>
        </div>
      </template>

      <AdultSignIn
        v-else-if="step === 'signIn'"
        heading="h1"
        :title="`Sign in to join ${householdName}`"
        hint="Use your own email. You’ll be signed out when you’ve joined."
        @signed-in="onSignedIn"
        @cancel="finish"
      />

      <template v-else-if="step === 'consent'">
        <h1 tabindex="-1" data-step-heading class="text-[32px] font-semibold text-ink outline-none">Your family’s information</h1>
        <ConsentChecks v-model:terms="agreeTerms" v-model:health="agreeHealth" />
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" :disabled="busy" @click="finish">Cancel</RButton>
          <RButton :disabled="!agreeTerms || !agreeHealth || busy || offline" @click="acceptConsent">Agree and continue</RButton>
        </div>
      </template>

      <template v-else>
        <h1 tabindex="-1" data-step-heading class="text-[32px] font-semibold text-ink outline-none">About you</h1>
        <RInput v-model="name" label="Your name" autocomplete="off" :maxlength="40" />
        <ColorPicker v-model="color" label="Your color" />
        <RInput v-model="pin" label="Choose a 4-digit PIN" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
        <RInput v-model="pinAgain" label="PIN again" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
        <div class="flex flex-wrap gap-3">
          <RButton variant="secondary" :disabled="busy" @click="finish">Cancel</RButton>
          <RButton :disabled="busy || offline" @click="join">{{ busy ? 'Joining…' : `Join ${householdName}` }}</RButton>
        </div>
      </template>

      <p v-if="offline" role="status" class="text-[18px] font-medium text-amber-deep">No connection. Connect to join.</p>
      <p v-if="error && step !== 'signIn'" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
    </div>
  </main>
</template>
