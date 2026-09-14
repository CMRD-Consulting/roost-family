<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import ConsentChecks from '../ConsentChecks.vue'
import RButton from '@/ui/RButton.vue'
import { POLICY_VERSION, type WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const terms = ref(false)
const health = ref(false)

async function accept() {
  if (!props.state.adult) return
  props.state.busy = true
  props.state.error = null
  try {
    const { error } = await props.state.adult.client.rpc('record_consent', {
      p_policy_version: POLICY_VERSION,
      p_health_data_consent: health.value,
    })
    if (error) throw new Error(error.message)
    emit('next')
  } catch (e) {
    props.state.error = (e as Error).message
  } finally {
    props.state.busy = false
  }
}
</script>

<template>
  <WizardFrame title="Your family’s information" :error="state.error" can-go-back @back="emit('back')">
    <ConsentChecks v-model:terms="terms" v-model:health="health" />
    <RButton :disabled="!terms || !health || state.busy" @click="accept">Agree and continue</RButton>
  </WizardFrame>
</template>
