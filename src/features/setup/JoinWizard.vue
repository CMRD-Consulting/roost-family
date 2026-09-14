<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WizardFrame from './WizardFrame.vue'
import SignInStep from './steps/SignInStep.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { createWizardState } from './wizardState'
import { LIMITS, validateDisplayLabel } from './validation'
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
const phase = ref<'signIn' | 'pick' | 'name'>('signIn')
const households = ref<{ id: string; name: string }[]>([])
const chosen = ref<string | null>(null)

useAdultSessionIdle({
  session: () => state.adult,
  busy: () => state.busy,
  onExpired: () => {
    state.adult = null
    chosen.value = null
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

async function cancel() {
  const adult = state.adult
  state.adult = null
  await adult?.end()
  await router.replace('/setup')
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
    if (error) throw new Error(error.message)
    const token = data?.[0]?.out_claim_token
    if (!token) throw new Error('Display registration returned no token')
    await claimDisplay(displayClient, token)
    state.adult = null
    await adult.end()
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    state.error = (e as Error).message
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
      @click="chosen = h.id; phase = 'name'"
    >
      {{ h.name }}
    </RButton>
    <RButton variant="ghost" @click="cancel">Cancel</RButton>
  </WizardFrame>
  <WizardFrame v-else title="Name this display" :error="state.error" can-go-back @back="phase = 'pick'">
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Playroom" :maxlength="LIMITS.displayName" />
    <RButton :disabled="state.busy" @click="register">Add this display</RButton>
  </WizardFrame>
</template>
