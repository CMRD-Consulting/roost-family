<script setup lang="ts">
import { ref, type ComponentPublicInstance } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import { validateInviteCode } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const boxes = ref<HTMLInputElement[]>([])

function onInput(i: number, e: Event) {
  const value = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const chars = props.state.inviteCode.padEnd(6, ' ').split('')
  chars[i] = value.slice(-1) || ' '
  props.state.inviteCode = chars.join('').trimEnd()
  if (value && i < 5) boxes.value[i + 1]?.focus()
}

function submit() {
  error.value = validateInviteCode(props.state.inviteCode)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Enter your invite code" subtitle="Roost Family is invite-only for now." :error="error" can-go-back @back="emit('back')">
    <div class="flex gap-3">
      <input
        v-for="i in 6"
        :key="i"
        :ref="(el: Element | ComponentPublicInstance | null) => { if (el) boxes[i - 1] = el as HTMLInputElement }"
        :value="state.inviteCode[i - 1] ?? ''"
        maxlength="1"
        autocapitalize="characters"
        :aria-label="`Invite code character ${i}`"
        class="h-[88px] w-[72px] rounded-[var(--radius-control)] border border-line bg-surface text-center text-[40px] font-semibold uppercase outline-none focus:border-orange"
        @input="onInput(i - 1, $event)"
      />
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
