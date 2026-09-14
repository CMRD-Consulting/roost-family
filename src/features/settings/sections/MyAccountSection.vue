<script setup lang="ts">
/**
 * My account (spec §7.9). On a display (Settings): my color (PIN session), and two actions that need a full sign-in
 * as the Settings adult (spec §6.3): changing my PIN and leaving the household. The adult session ends after 5
 * minutes without a touch, when the action is done, or when this section closes. In a browser (Manage household,
 * spec §7.10) the adult is already signed in: only leaving the household, with no sign-in of its own. `host` is
 * where the section is shown (see sectionHosts). The `calendars` slot is where the calendar settings go: Manage
 * household fills it with its signed-in adult's; on a display it defaults to "My calendars", behind a full sign-in.
 */
import { computed, ref, shallowRef } from 'vue'
import { isDemo } from '@/data/householdSource'
import { SettingsError } from '@/data/settingsApi'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import AdultSignIn from '../AdultSignIn.vue'
import CalendarsSection from './CalendarsSection.vue'
import { useNightHold } from '../useNightHold'
import { validateNewPin } from '../myAccountForm'
import { useDisplayAccountHost, type AccountSectionHost } from '../sectionHosts'
import { settingsErrorMessage } from '../settingsErrors'
import MyColorCard from './MyColorCard.vue'

defineSlots<{ calendars?: () => unknown }>()
const props = defineProps<{ host?: AccountSectionHost }>()
const host = props.host ?? useDisplayAccountHost()
const { offline, lastOwner } = host

const myName = computed(() => host.me.value?.displayName ?? '')
const householdName = computed(() => host.household.value?.name ?? 'this household')

// ─── Full sign-in actions ──────────────────────────────────────────────────
type Action = 'pin' | 'leave' | 'calendars'
type Phase = 'idle' | 'signIn' | 'act'

const action = ref<Action | null>(null)
const phase = ref<Phase>('idle')
// Night Mode waits while the full sign-in (and what it unlocked) is open.
if (host.holdsNight) useNightHold(() => phase.value !== 'idle')
const adult = shallowRef<AdultSession | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
/** Bumped to give the sign-in form a fresh client after a refused account. */
const signInKey = ref(0)

function reset(): void {
  action.value = null
  phase.value = 'idle'
  busy.value = false
}

function endAdult(): void {
  const current = adult.value
  adult.value = null
  if (current) void current.end().catch(() => {})
}

useAdultSessionIdle({
  session: () => adult.value,
  busy: () => busy.value,
  onExpired: () => {
    adult.value = null
    reset()
    notice.value = 'Signed out after 5 minutes without a touch.'
  },
})

function start(next: Action): void {
  error.value = null
  notice.value = null
  if (isDemo) {
    error.value = 'Not available in demo.'
    return
  }
  endAdult()
  action.value = next
  // Already signed in (Manage household): straight to the action.
  phase.value = host.signedIn ? 'act' : 'signIn'
}

const signInTitle = computed(() => {
  if (action.value === 'pin') return `Sign in as ${myName.value} to change your PIN`
  if (action.value === 'calendars') return `Sign in as ${myName.value} to manage your calendars`
  return `Sign in as ${myName.value} to leave ${householdName.value}`
})

function cancel(): void {
  endAdult()
  reset()
  error.value = null
}

/** Wording for a failed full-sign-in action: a refused sign-in is not a PIN problem. */
function actionErrorMessage(e: unknown): string {
  if (e instanceof SettingsError && e.code === 'auth') return 'Roost Family didn’t accept that sign-in. Sign in again.'
  return settingsErrorMessage(e)
}

async function onSignedIn(signedIn: AdultSession): Promise<void> {
  adult.value = signedIn
  const info = host.me.value
  const householdId = host.household.value?.id
  if (!info || !householdId) return cancel()
  busy.value = true
  try {
    const api = await host.loadApi()
    const membership = await api.adultMembership(signedIn.client, householdId, signedIn.userId)
    if (membership?.membershipId !== info.membershipId) {
      error.value = `That account isn’t ${myName.value}’s. Sign in with ${myName.value}’s email.`
      endAdult()
      signInKey.value += 1
      phase.value = 'signIn'
      return
    }
    phase.value = 'act'
  } catch (e) {
    error.value = actionErrorMessage(e)
    endAdult()
    reset()
  } finally {
    busy.value = false
  }
}

// Change my PIN
const newPin = ref('')
const newPinAgain = ref('')

async function submitPin(): Promise<void> {
  const signedIn = adult.value
  const info = host.me.value
  const householdId = host.household.value?.id
  const pinSession = host.pinSession
  if (!signedIn || !info || !householdId || !pinSession || busy.value || offline.value) return
  error.value = validateNewPin(newPin.value, newPinAgain.value)
  if (error.value) return
  const pin = newPin.value
  busy.value = true
  try {
    const api = await host.loadApi()
    await api.setMyPin(signedIn.client, householdId, pin)
  } catch (e) {
    error.value = actionErrorMessage(e)
    busy.value = false
    return
  }
  newPin.value = ''
  newPinAgain.value = ''
  endAdult()
  reset()
  if (await pinSession.afterPinChanged(info.membershipId, pin)) notice.value = 'Your PIN is changed.'
}

// Leave household
async function confirmLeave(): Promise<void> {
  const client = host.signedIn?.client ?? adult.value?.client
  const householdId = host.household.value?.id
  if (!client || !householdId || busy.value || offline.value) return
  error.value = null
  busy.value = true
  try {
    const api = await host.loadApi()
    await api.leaveHousehold(client, householdId)
  } catch (e) {
    error.value = actionErrorMessage(e)
    busy.value = false
    host.onActionError?.(e)
    return
  }
  endAdult()
  reset()
  // This adult is no longer a member: Settings closes and the tablet returns to the main screen (a browser goes
  // back to its households).
  host.afterLeft()
}
</script>

<template>
  <section aria-labelledby="settings-my-account-title" class="flex flex-col gap-5">
    <h2 id="settings-my-account-title" class="text-[32px] font-semibold text-ink">My account</h2>
    <p class="text-[18px] text-ink-3">Settings for {{ myName }} in {{ householdName }}.</p>

    <MyColorCard v-if="host.pinSession" />

    <slot name="calendars">
      <div v-if="host.surface === 'display' && phase === 'idle'" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 class="text-[22px] font-semibold text-ink">Calendars</h3>
        <p class="text-[18px] text-ink-3">
          Connect your calendars and choose whose events they are. This needs a full sign-in with your email.
        </p>
        <div>
          <RButton variant="secondary" :disabled="offline" @click="start('calendars')">Manage my calendars</RButton>
        </div>
      </div>
    </slot>

    <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
    <p v-if="error && phase !== 'signIn'" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

    <template v-if="phase === 'idle'">
      <div v-if="host.pinSession" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 class="text-[22px] font-semibold text-ink">PIN</h3>
        <p class="text-[18px] text-ink-3">Changing your PIN needs a full sign-in with your email.</p>
        <div>
          <RButton variant="secondary" :disabled="offline" @click="start('pin')">Change my PIN</RButton>
        </div>
      </div>

      <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <h3 class="text-[22px] font-semibold text-ink">Leave household</h3>
        <p class="text-[18px] text-ink-3">Your past entries stay, attributed to you as a former member.</p>
        <p v-if="lastOwner" class="text-[18px] text-ink-2">
          You’re the only owner. Make another adult an owner in Members before you leave.
        </p>
        <div>
          <RButton variant="secondary" :disabled="lastOwner || offline" @click="start('leave')">Leave household</RButton>
        </div>
      </div>
    </template>

    <template v-else-if="phase === 'signIn'">
      <AdultSignIn
        :key="signInKey"
        :title="signInTitle"
        hint="A full sign-in ends after 5 minutes without a touch."
        @signed-in="onSignedIn"
        @cancel="cancel"
      />
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
    </template>

    <div v-else-if="action === 'calendars'" class="flex flex-col gap-4">
      <CalendarsSection
        v-if="adult && host.me.value && host.household.value"
        :client="adult.client"
        :household-id="host.household.value.id"
        :membership-id="host.me.value.membershipId"
        surface="display"
        :heading-level="3"
      />
      <div>
        <RButton variant="secondary" @click="cancel">Done with calendars</RButton>
      </div>
    </div>

    <div v-else-if="action === 'pin'" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[22px] font-semibold text-ink">Choose a new PIN</h3>
      <RInput v-model="newPin" label="New PIN" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
      <RInput v-model="newPinAgain" label="New PIN again" inputmode="numeric" autocomplete="off" :maxlength="4" masked />
      <div class="flex flex-wrap gap-3">
        <RButton variant="secondary" :disabled="busy" @click="cancel">Cancel</RButton>
        <RButton :disabled="busy || offline" @click="submitPin">{{ busy ? 'Saving…' : 'Save new PIN' }}</RButton>
      </div>
    </div>

    <div v-else class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[22px] font-semibold text-ink">Leave {{ householdName }}?</h3>
      <p class="text-[18px] text-ink-2">
        <template v-if="host.surface === 'display'">You won’t be able to open Settings or use your PIN here.</template>
        <template v-else>You’ll lose access to {{ householdName }}, and your PIN stops working on its displays.</template>
        Your past entries stay, attributed to you as a former member.
      </p>
      <div class="flex flex-wrap gap-3">
        <RButton variant="secondary" :disabled="busy" @click="cancel">Cancel</RButton>
        <RButton variant="danger" :disabled="busy || offline" @click="confirmLeave">Leave {{ householdName }}</RButton>
      </div>
    </div>
  </section>
</template>
