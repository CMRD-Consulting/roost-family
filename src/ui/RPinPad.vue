<script setup lang="ts">
/** Adult avatar picker + 4-digit PIN keypad (spec §7.3). No lockout after wrong attempts. */
import { computed, ref } from 'vue'
import type { Member } from '@/data/snapshot'
import RAvatar from './RAvatar.vue'

const props = withDefaults(
  defineProps<{
    members: Member[]
    verify: (membershipId: string, pin: string) => Promise<boolean>
    title?: string
  }>(),
  { title: 'Enter your PIN' },
)
const emit = defineEmits<{ verified: [{ membershipId: string; pin: string }]; cancel: [] }>()

/** Owners and adults only — sitters use a different flow (Phase 3). */
const eligibleMembers = computed(() => props.members.filter((m) => m.role === 'owner' || m.role === 'adult'))

const selected = ref<Member | null>(null)
const pin = ref('')
const error = ref<string | null>(null)
const shake = ref(false)
const pending = ref(false)

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const
const PIN_LENGTH = 4

const progress = computed(() => `${pin.value.length} of ${PIN_LENGTH} digits entered`)

function pick(member: Member): void {
  selected.value = member
  pin.value = ''
  error.value = null
}

function backToWho(): void {
  selected.value = null
  pin.value = ''
  error.value = null
}

async function submit(): Promise<void> {
  const member = selected.value
  if (!member) return
  pending.value = true
  try {
    let ok: boolean
    try {
      ok = await props.verify(member.id, pin.value)
    } catch {
      error.value = "Couldn't check the PIN. Try again."
      pin.value = ''
      return
    }
    if (ok) {
      emit('verified', { membershipId: member.id, pin: pin.value })
    } else {
      error.value = "That PIN didn't match."
      shake.value = true
      pin.value = ''
    }
  } finally {
    pending.value = false
  }
}

async function press(key: string): Promise<void> {
  if (key === '' || pending.value) return
  if (key === '⌫') {
    pin.value = pin.value.slice(0, -1)
    return
  }
  if (pin.value.length >= PIN_LENGTH) return
  pin.value += key
  if (pin.value.length === PIN_LENGTH) await submit()
}
</script>

<template>
  <div class="flex flex-col items-center gap-6">
    <h2 class="text-[24px] font-semibold text-ink">{{ title }}</h2>

    <ul
      v-if="!selected"
      aria-label="Choose who you are"
      class="grid gap-6"
      :class="eligibleMembers.length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
    >
      <li v-for="member in eligibleMembers" :key="member.id">
        <button
          type="button"
          :aria-label="member.displayName"
          class="flex flex-col items-center gap-2 rounded-[var(--radius-control)] p-2"
          @click="pick(member)"
        >
          <RAvatar :name="member.displayName" :color="member.color" :size="96" decorative />
          <span class="text-[22px] font-medium text-ink">{{ member.displayName }}</span>
        </button>
      </li>
    </ul>

    <div v-else class="flex flex-col items-center gap-6">
      <button
        type="button"
        class="flex min-h-[60px] items-center gap-2 rounded-full bg-surface-2 py-1 pr-4 pl-1"
        @click="backToWho"
      >
        <RAvatar :name="selected.displayName" :color="selected.color" :size="44" decorative />
        <span class="text-[18px] text-ink-3">Not you?</span>
      </button>

      <div class="flex gap-4" aria-hidden="true" :class="shake && 'r-pinpad-shake'" @animationend="shake = false">
        <span
          v-for="i in 4"
          :key="i"
          class="h-5 w-5 rounded-full border-[3px] border-ink"
          :class="i <= pin.length ? 'bg-ink' : 'bg-transparent'"
        />
      </div>

      <p aria-live="polite" class="sr-only">{{ progress }}</p>

      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

      <div data-keypad class="grid grid-cols-3 gap-3">
        <template v-for="(key, i) in KEYS" :key="i">
          <span v-if="key === ''" data-spacer aria-hidden="true" class="min-h-[72px] min-w-[72px]" />
          <button
            v-else
            type="button"
            :aria-label="key === '⌫' ? 'Backspace' : key"
            class="flex min-h-[72px] min-w-[72px] items-center justify-center rounded-[var(--radius-control)] bg-surface-2 text-[32px] font-medium text-ink"
            @click="press(key)"
          >
            {{ key }}
          </button>
        </template>
      </div>
    </div>

    <button
      type="button"
      class="min-h-[60px] w-full rounded-[var(--radius-control)] bg-surface-2 text-[19px] font-medium text-ink"
      @click="emit('cancel')"
    >
      Cancel
    </button>
  </div>
</template>

<style scoped>
@keyframes r-pinpad-shake {
  10%,
  90% {
    transform: translateX(-1px);
  }
  20%,
  80% {
    transform: translateX(2px);
  }
  30%,
  50%,
  70% {
    transform: translateX(-4px);
  }
  40%,
  60% {
    transform: translateX(4px);
  }
}
.r-pinpad-shake {
  animation: r-pinpad-shake 0.4s;
}
</style>
