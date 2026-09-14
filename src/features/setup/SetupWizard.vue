<script setup lang="ts">
import type { Component } from 'vue'
import { createWizardState, nextStep, previousStep, type SetupStep } from './wizardState'
import { useAdultSessionIdle } from '@/session/useAdultSessionIdle'
import WelcomeStep from './steps/WelcomeStep.vue'
import InviteStep from './steps/InviteStep.vue'
import SignInStep from './steps/SignInStep.vue'
import ConsentStep from './steps/ConsentStep.vue'
import HouseholdStep from './steps/HouseholdStep.vue'
import KidsStep from './steps/KidsStep.vue'
import YouStep from './steps/YouStep.vue'
import DisplayStep from './steps/DisplayStep.vue'

const state = createWizardState()
const components: Record<SetupStep, Component> = {
  welcome: WelcomeStep,
  invite: InviteStep,
  signIn: SignInStep,
  consent: ConsentStep,
  household: HouseholdStep,
  kids: KidsStep,
  you: YouStep,
  display: DisplayStep,
}

useAdultSessionIdle({
  session: () => state.adult,
  busy: () => state.busy,
  onExpired: () => {
    state.adult = null
    state.step = 'signIn'
    state.error = 'You were signed out after 5 minutes without activity. Sign in again to continue.'
  },
})

function go(step: SetupStep) {
  state.error = null
  state.step = step
}
</script>

<template>
  <component
    :is="components[state.step]"
    :state="state"
    @next="go(nextStep(state.step, { signedIn: !!state.adult }))"
    @back="go(previousStep(state.step, { signedIn: !!state.adult }))"
  />
</template>
