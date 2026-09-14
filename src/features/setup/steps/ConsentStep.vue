<script setup lang="ts">
import { ref, useId } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import { POLICY_VERSION, type WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const terms = ref(false)
const health = ref(false)
const termsId = useId()
const healthId = useId()

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
    <p class="text-[20px] text-ink-2">
      Roost Family stores your children’s sleep, feeding and medicine logs so everyone caring for them sees the same
      thing. We never show ads, never sell data, and never share it with analytics companies. You can export or delete
      everything at any time.
    </p>
    <div class="flex min-h-[44px] items-center gap-4 text-[20px]">
      <input :id="termsId" v-model="terms" type="checkbox" class="size-7 shrink-0 accent-[var(--color-orange-deep)]" />
      <label :for="termsId">I agree to the Terms and Privacy Policy.</label>
    </div>
    <div class="flex min-h-[44px] items-center gap-4 text-[20px]">
      <input :id="healthId" v-model="health" type="checkbox" class="size-7 shrink-0 accent-[var(--color-orange-deep)]" />
      <label :for="healthId">
        I consent to Roost Family storing my children’s health information (medicine, sleep and feeding logs).
      </label>
    </div>
    <RButton :disabled="!terms || !health || state.busy" @click="accept">Agree and continue</RButton>
  </WizardFrame>
</template>
