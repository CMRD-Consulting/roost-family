<script setup lang="ts">
/** The terms and health-data consent (spec §6.4, §11): the explanation and both required checkboxes. Shared by
 *  household setup and a new adult joining from Settings > Members, so every adult agrees to the same words. */
import { useId } from 'vue'

const terms = defineModel<boolean>('terms', { required: true })
const health = defineModel<boolean>('health', { required: true })
const termsId = useId()
const healthId = useId()
</script>

<template>
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
</template>
