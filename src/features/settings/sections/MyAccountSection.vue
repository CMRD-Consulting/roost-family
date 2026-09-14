<script setup lang="ts">
/**
 * Settings > My account (spec §7.9): my color (PIN session), and two actions that need a full sign-in as the
 * Settings adult (spec §6.3): changing my PIN and leaving the household. The adult session ends after 5
 * minutes without a touch, when the action is done, or when this section closes. Calendars come in Phase 4.
 */
import { computed, ref, shallowRef } from 'vue'
import { isDemo } from '@/data/householdSource'
import { SettingsError } from '@/data/settingsApi'
import type { AdultSession } from '@/session/adultSession'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import AdultSignIn from '../AdultSignIn.vue'
import ColorPicker from '../forms/ColorPicker.vue'
import SaveRow from '../forms/SaveRow.vue'
import { isLastOwner, validateNewPin } from '../myAccountForm'
import { loadSettingsApi } from '../settingsApiLoader'
import { settingsErrorMessage } from '../settingsErrors'
import { useSettingsOffline, useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()
const session = useSettingsSessionStore()
const offline = useSettingsOffline()

const me = computed(() => store.view?.members.find((m) => m.id === session.info?.membershipId) ?? null)
const myName = computed(() => session.info?.displayName ?? me.value?.displayName ?? '')
const householdName = computed(() => store.view?.household.name ?? 'this household')

// ─── My color ──────────────────────────────────────────────────────────────
const color = ref<string | null>(me.value?.color ?? null)
const { saving: colorSaving, saved: colorSaved, error: colorError, save: saveColor } = useSettingsSave()

async function submitColor(): Promise<void> {
  const chosen = color.value
  if (!chosen) return
  await saveColor((api, auth) => api.setMyColor(auth, chosen))
}

// ─── Full sign-in actions ──────────────────────────────────────────────────
type Action = 'pin' | 'leave'
type Phase = 'idle' | 'signIn' | 'act'

const action = ref<Action | null>(null)
const phase = ref<Phase>('idle')
const adult = shallowRef<AdultSession | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
/** Bumped to give the sign-in form a fresh client after a refused account. */
const signInKey = ref(0)

const lastOwner = computed(() => (store.view && session.info ? isLastOwner(store.view.members, session.info.membershipId) : false))

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
  phase.value = 'signIn'
}

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
  const info = session.info
  const householdId = store.view?.household.id
  if (!info || !householdId) return cancel()
  busy.value = true
  try {
    const api = await loadSettingsApi()
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
  const info = session.info
  const householdId = store.view?.household.id
  if (!signedIn || !info || !householdId || busy.value || offline.value) return
  error.value = validateNewPin(newPin.value, newPinAgain.value)
  if (error.value) return
  const pin = newPin.value
  busy.value = true
  try {
    const api = await loadSettingsApi()
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
  // The settings session holds the old PIN; reopen it with the new one so Settings keeps working.
  try {
    await session.enter(info.membershipId, pin)
    notice.value = 'Your PIN is changed.'
  } catch {
    session.end()
  }
}

// Leave household
async function confirmLeave(): Promise<void> {
  const signedIn = adult.value
  const householdId = store.view?.household.id
  if (!signedIn || !householdId || busy.value || offline.value) return
  error.value = null
  busy.value = true
  try {
    const api = await loadSettingsApi()
    await api.leaveHousehold(signedIn.client, householdId)
  } catch (e) {
    error.value = actionErrorMessage(e)
    busy.value = false
    return
  }
  endAdult()
  reset()
  // This adult is no longer a member: Settings closes and the tablet returns to the main screen.
  session.end()
}
</script>

<template>
  <section aria-labelledby="settings-my-account-title" class="flex flex-col gap-5">
    <h2 id="settings-my-account-title" class="text-[32px] font-semibold text-ink">My account</h2>
    <p class="text-[18px] text-ink-3">Settings for {{ myName }} in {{ householdName }}.</p>

    <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <ColorPicker v-model="color" label="My color" />
      <p class="text-[18px] text-ink-3">Shown with your initial wherever your entries appear.</p>
      <SaveRow :saving="colorSaving" :saved="colorSaved" :error="colorError" :disabled="offline || !color" @save="submitColor" />
    </div>

    <p v-if="notice" role="status" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
    <p v-if="error && phase !== 'signIn'" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

    <template v-if="phase === 'idle'">
      <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
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
        :title="action === 'pin' ? `Sign in as ${myName} to change your PIN` : `Sign in as ${myName} to leave ${householdName}`"
        hint="A full sign-in ends after 5 minutes without a touch."
        @signed-in="onSignedIn"
        @cancel="cancel"
      />
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
    </template>

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
        You won’t be able to open Settings or use your PIN here. Your past entries stay, attributed to you as a former member.
      </p>
      <div class="flex flex-wrap gap-3">
        <RButton variant="secondary" :disabled="busy" @click="cancel">Cancel</RButton>
        <RButton variant="danger" :disabled="busy || offline" @click="confirmLeave">Leave {{ householdName }}</RButton>
      </div>
    </div>
  </section>
</template>
