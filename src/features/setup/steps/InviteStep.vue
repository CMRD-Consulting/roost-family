<script setup lang="ts">
import { computed, ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import { LIMITS, normalizeInviteCode, validateInviteCode } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)
const focused = ref(false)
const activeBox = computed(() => Math.min(props.state.inviteCode.length, LIMITS.inviteCode - 1))

function setCode(input: HTMLInputElement, raw: string) {
  const code = normalizeInviteCode(raw)
  props.state.inviteCode = code
  if (input.value !== code) input.value = code
}

function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  setCode(input, input.value)
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')
  if (text == null) return
  e.preventDefault()
  setCode(e.target as HTMLInputElement, text)
}

function submit() {
  error.value = validateInviteCode(props.state.inviteCode)
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Enter your invite code" subtitle="Roost Family is invite-only for now." :error="error" can-go-back @back="emit('back')">
    <div class="relative w-fit">
      <!-- Six boxes mirror the value; one transparent input on top takes typing, paste and autofill. -->
      <div class="flex gap-3" aria-hidden="true">
        <span
          v-for="i in LIMITS.inviteCode"
          :key="i"
          class="flex h-[88px] w-[72px] items-center justify-center rounded-[var(--radius-control)] border-2 bg-surface text-[40px] font-semibold text-ink tabular-nums"
          :class="focused && activeBox === i - 1 ? 'border-orange-deep outline-3 outline-offset-2 outline-orange-deep' : 'border-ink-3'"
        >
          {{ state.inviteCode[i - 1] ?? '' }}
        </span>
      </div>
      <input
        :value="state.inviteCode"
        :maxlength="LIMITS.inviteCode"
        type="text"
        inputmode="text"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        autocomplete="off"
        aria-label="Invite code, 6 letters or numbers"
        class="invite-input absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
        @input="onInput"
        @paste="onPaste"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter="submit"
      />
    </div>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>

<style scoped>
/* Keep selection highlights from painting over the mirrored boxes. */
.invite-input::selection {
  background: transparent;
}
</style>
