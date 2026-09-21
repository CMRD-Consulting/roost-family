<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RCodeInput from '@/ui/RCodeInput.vue'
import { LIMITS, validateInviteCode } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)

function submit() {
  error.value = validateInviteCode(props.state.inviteCode)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Enter your invite code" subtitle="Roost Family is invite-only for now." :error="error" can-go-back @back="emit('back')">
    <RCodeInput
      v-model="state.inviteCode"
      label="Invite code, 6 letters or numbers"
      mode="code"
      :length="LIMITS.inviteCode"
      @submit="submit"
    />
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>

