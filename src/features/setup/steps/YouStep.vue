<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RAvatar from '@/ui/RAvatar.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import { validatePin } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const confirm = ref('')
const error = ref<string | null>(null)

function submit() {
  if (!props.state.displayName.trim()) {
    error.value = 'Tell us what to call you.'
    return
  }
  error.value = validatePin(props.state.pin, confirm.value)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="About you" subtitle="Your PIN unlocks Settings and confirms medicine doses on the tablet." :error="error" can-go-back @back="emit('back')">
    <div class="flex items-center gap-4">
      <RAvatar :name="state.displayName || '?'" :color="state.color" :size="56" />
      <div class="flex-1"><RInput v-model="state.displayName" label="Your name" autocomplete="given-name" /></div>
    </div>
    <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Your color">
      <button
        v-for="c in PERSON_COLORS"
        :key="c"
        type="button"
        role="radio"
        :aria-checked="state.color === c"
        :aria-label="`Color ${c}`"
        class="size-11 rounded-full border-4"
        :class="state.color === c ? 'border-ink' : 'border-transparent'"
        :style="{ background: c }"
        @click="state.color = c"
      />
    </div>
    <RInput v-model="state.pin" label="4-digit PIN" type="password" inputmode="numeric" autocomplete="new-password" />
    <RInput v-model="confirm" label="Enter it again" type="password" inputmode="numeric" autocomplete="new-password" />
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
