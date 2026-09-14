<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import WizardFrame from './WizardFrame.vue'
import SignInStep from './steps/SignInStep.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import { createWizardState } from './wizardState'
import { displayClient } from '@/data/supabase'
import { claimDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'

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

function householdName(row: MembershipHouseholdRow): string {
  const h = Array.isArray(row.households) ? row.households[0] : row.households
  return h?.name ?? 'Household'
}

async function loadHouseholds() {
  const adult = state.adult
  if (!adult) return
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
  if (households.value.length === 0) state.error = 'This account isn’t an owner of any household.'
  phase.value = 'pick'
}

async function register() {
  const adult = state.adult
  if (!adult || !chosen.value) return
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
    await adult.end()
    state.adult = null
    await displayStore.refresh()
    await router.replace('/home')
  } catch (e) {
    state.error = (e as Error).message
  } finally {
    state.busy = false
  }
}

onBeforeUnmount(() => void state.adult?.end())
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
    <RButton
      v-for="h in households"
      :key="h.id"
      :variant="chosen === h.id ? 'primary' : 'secondary'"
      @click="chosen = h.id; phase = 'name'"
    >
      {{ h.name }}
    </RButton>
  </WizardFrame>
  <WizardFrame v-else title="Name this display" :error="state.error" can-go-back @back="phase = 'pick'">
    <RInput v-model="state.displayLabel" label="Display name" placeholder="Playroom" />
    <RButton :disabled="state.busy" @click="register">Add this display</RButton>
  </WizardFrame>
</template>
