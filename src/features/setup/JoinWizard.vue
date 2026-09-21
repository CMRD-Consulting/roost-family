<script setup lang="ts">
/**
 * Join a household (spec §6.4): an owner signs in on the tablet, picks the household, and either reconnects it as
 * one of the household's displays (a tablet that was signed out keeps its name, its place among the 3 and its
 * history) or adds it as a new one. Both end the same way: a one-time claim token binds this device.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import WizardFrame from './WizardFrame.vue'
import SignInStep from './steps/SignInStep.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { createWizardState } from './wizardState'
import { LIMITS, validateDisplayLabel } from './validation'
import { joinDisplayErrorMessage } from './completeSetup'
import { buildJoinDisplayChoices, reconnectWarning, type JoinDisplayChoice, type JoinDisplayRow } from './joinDisplayChoices'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'

interface MembershipHouseholdRow {
  household_id: string
  households: { name: string } | { name: string }[] | null
}

const router = useRouter()
const displayStore = useDisplayStore()
const state = createWizardState()
const phase = ref<'signIn' | 'pick' | 'which' | 'confirm' | 'name'>('signIn')
const households = ref<{ id: string; name: string }[]>([])
const chosen = ref<string | null>(null)
const displays = ref<JoinDisplayRow[]>([])
const reconnecting = ref<JoinDisplayChoice | null>(null)

const chosenName = computed(() => households.value.find((h) => h.id === chosen.value)?.name ?? 'This household')
const choices = computed(() => buildJoinDisplayChoices(displays.value, new Date()))

useAdultSessionIdle({
  session: () => state.adult,
  busy: () => state.busy,
  onExpired: () => {
    state.adult = null
    chosen.value = null
    displays.value = []
    reconnecting.value = null
    phase.value = 'signIn'
    state.error = 'You were signed out after 5 minutes without activity. Sign in again to continue.'
  },
})

function householdName(row: MembershipHouseholdRow): string {
  const h = Array.isArray(row.households) ? row.households[0] : row.households
  return h?.name ?? 'Household'
}

async function loadHouseholds() {
  const adult = state.adult
  if (!adult) return
  state.busy = true
  try {
    const { data, error } = await adult.client
      .from('memberships')
      .select('household_id, households(name)')
      .eq('user_id', adult.userId)
      .eq('role', 'owner')
      .is('left_at', null)
    if (error) {
      state.error = error.message
      return
    }
    households.value = (data ?? []).map((m) => ({
      id: m.household_id,
      name: householdName(m as MembershipHouseholdRow),
    }))
    phase.value = 'pick'
  } finally {
    state.busy = false
  }
}

/** The household's displays this tablet could be. With none, there is nothing to ask: it is a new display. */
async function pickHousehold(householdId: string) {
  const adult = state.adult
  if (!adult || state.busy) return
  chosen.value = householdId
  state.busy = true
  state.error = null
  try {
    const { data, error } = await adult.client
      .from('displays')
      .select('id, name, last_seen_at, auth_user_id')
      .eq('household_id', householdId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
    if (error) {
      state.error = error.message
      return
    }
    displays.value = (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.last_seen_at,
      connected: d.auth_user_id !== null,
    }))
    phase.value = displays.value.length > 0 ? 'which' : 'name'
  } finally {
    state.busy = false
  }
}

async function cancel() {
  const adult = state.adult
  state.adult = null
  await adult?.end()
  await router.replace('/setup')
}

/** Binds this device with the claim token, signs the owner out and opens the main screen. */
async function finish(token: string | undefined) {
  const adult = state.adult
  if (!adult) return
  if (!token) throw new Error('The server returned no claim token')
  await claimDisplay(displayClient, token)
  state.adult = null
  await adult.end()
  await displayStore.refresh()
  await router.replace('/home')
}

async function register() {
  const adult = state.adult
  if (!adult || !chosen.value) return
  state.error = validateDisplayLabel(state.displayLabel)
  if (state.error) return
  state.busy = true
  state.error = null
  try {
    const { data, error } = await adult.client.rpc('register_display', {
      p_household_id: chosen.value,
      p_name: state.displayLabel.trim(),
    })
    if (error) throw new Error(joinDisplayErrorMessage(error.message, chosenName.value))
    await finish(data?.[0]?.out_claim_token)
  } catch (e) {
    state.error = (e as Error).message
  } finally {
    state.busy = false
  }
}

function chooseDisplay(choice: JoinDisplayChoice) {
  state.error = null
  reconnecting.value = choice
  if (choice.recentlyActive) phase.value = 'confirm'
  else void reconnect()
}

async function reconnect() {
  const adult = state.adult
  const choice = reconnecting.value
  if (!adult || !choice || state.busy) return
  state.busy = true
  state.error = null
  try {
    const { data, error } = await adult.client.rpc('reconnect_display', { p_display_id: choice.displayId })
    if (error) throw new Error(joinDisplayErrorMessage(error.message, chosenName.value))
    await finish(data?.[0]?.out_claim_token)
  } catch (e) {
    state.error = (e as Error).message
    phase.value = 'which'
  } finally {
    state.busy = false
  }
}
</script>

<template>
  <SignInStep
    v-if="phase === 'signIn'"
    :state="state"
    title="Owner sign-in"
    @next="loadHouseholds"
    @back="router.replace('/setup')"
  />
  <WizardFrame v-else-if="phase === 'pick'" title="Which household?" :error="state.error">
    <p v-if="households.length === 0" class="text-[20px] text-ink-2">
      This account isn’t an owner of any household. Sign in with an owner’s account to add this tablet.
    </p>
    <RButton
      v-for="h in households"
      :key="h.id"
      :variant="chosen === h.id ? 'primary' : 'secondary'"
      :disabled="state.busy"
      @click="pickHousehold(h.id)"
    >
      {{ h.name }}
    </RButton>
    <RButton variant="ghost" @click="cancel">Cancel</RButton>
  </WizardFrame>
  <WizardFrame
    v-else-if="phase === 'which'"
    title="Which display is this?"
    :subtitle="`If this tablet was one of ${chosenName}’s displays, pick it to reconnect. It keeps its name and history.`"
    :error="state.error"
    can-go-back
    @back="phase = 'pick'"
  >
    <ul class="flex flex-col gap-3" aria-label="Displays to reconnect">
      <li v-for="c in choices" :key="c.displayId">
        <RButton
          variant="secondary"
          class="w-full"
          :disabled="state.busy"
          :data-testid="`reconnect-${c.displayId}`"
          @click="chooseDisplay(c)"
        >
          <span class="flex flex-col items-start py-1 text-left">
            <span class="text-[20px] font-semibold text-ink">{{ c.name }}</span>
            <span class="text-[18px] font-normal text-ink-2">{{ c.detail }}</span>
          </span>
        </RButton>
      </li>
    </ul>
    <RButton variant="ghost" :disabled="state.busy" data-testid="add-new-display" @click="phase = 'name'">Add as a new display</RButton>
  </WizardFrame>
  <WizardFrame
    v-else-if="phase === 'confirm' && reconnecting"
    :title="`Reconnect as ${reconnecting.name}?`"
    :error="state.error"
    can-go-back
    @back="phase = 'which'"
  >
    <p class="text-[20px] text-ink">{{ reconnectWarning(reconnecting) }}</p>
    <RButton :disabled="state.busy" data-testid="reconnect-anyway" @click="reconnect">Reconnect anyway</RButton>
  </WizardFrame>
  <WizardFrame
    v-else
    title="Name this display"
    :error="state.error"
    can-go-back
    @back="phase = displays.length > 0 ? 'which' : 'pick'"
  >
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Playroom" :maxlength="LIMITS.displayName" />
    <RButton :disabled="state.busy" @click="register">Add this display</RButton>
  </WizardFrame>
</template>
