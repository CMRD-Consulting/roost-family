<script setup lang="ts">
/**
 * Adult PIN for the end of Sitter Mode (spec §7.3, §7.6). `end` ends the household's active session and emits
 * `done` with its id, for the caller to show that session's summary. `unlockSummary` only checks the PIN before
 * another display shows the summary of a session that has already ended. Both need a connection (the PIN is
 * checked on the server).
 */
import { computed, ref, watch } from 'vue'
import { LogWriteError } from '@/data/logWriter'
import SheetError from '@/features/logs/SheetError.vue'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import RButton from '@/ui/RButton.vue'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'

const props = withDefaults(
  defineProps<{ open: boolean; action?: 'end' | 'unlockSummary'; sessionId?: string | null }>(),
  { action: 'end', sessionId: null },
)
const emit = defineEmits<{ close: []; done: [sessionId: string] }>()

const COPY = {
  end: { title: 'End Sitter Mode', offline: 'Connect to end Sitter Mode.', failed: "Couldn't end Sitter Mode. Try again." },
  unlockSummary: { title: 'See the summary', offline: 'Connect to see the summary.', failed: "Couldn't open the summary. Try again." },
} as const

const householdStore = useHouseholdStore()
const logStore = useLogStore()

const copy = computed(() => COPY[props.action])
const members = computed(() => householdStore.view?.members ?? [])
const pending = ref(false)
const error = ref<string | null>(null)
const padKey = ref(0)

const offline = computed(
  () => householdStore.online === false || (typeof navigator !== 'undefined' && navigator.onLine === false),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pending.value = false
    error.value = null
    padKey.value++
  },
  { immediate: true },
)

function verify(membershipId: string, pin: string): Promise<boolean> {
  return logStore.verifyPin(membershipId, pin)
}

async function onVerified({ membershipId, pin }: { membershipId: string; pin: string }): Promise<void> {
  const view = householdStore.view
  if (!view || pending.value) return

  if (props.action === 'unlockSummary') {
    if (props.sessionId !== null) emit('done', props.sessionId)
    return
  }

  // Read now, not when the dialog opened: after a start, the reload replaces the optimistic id with the server's.
  const session = view.activeSitterSession ?? null
  if (session === null) {
    // Already ended (e.g. on another display).
    emit('close')
    return
  }
  pending.value = true
  error.value = null
  try {
    await logStore.submit({
      kind: 'sitter.end',
      householdId: view.household.id,
      sessionId: session.id,
      membershipId,
      pin,
      endedAt: new Date().toISOString(),
    })
  } catch (e) {
    error.value = e instanceof LogWriteError && e.network ? copy.value.offline : copy.value.failed
    padKey.value++
    return
  } finally {
    pending.value = false
  }
  emit('done', session.id)
}
</script>

<template>
  <RSheet :title="copy.title" :open="open" @close="emit('close')">
    <div class="flex flex-col items-center gap-6">
      <template v-if="offline">
        <p role="status" class="text-[22px] text-ink">{{ copy.offline }}</p>
        <RButton variant="secondary" tier="moment" class="w-full" @click="emit('close')">Close</RButton>
      </template>
      <template v-else>
        <SheetError :message="error" />
        <RPinPad
          :key="padKey"
          :members="members"
          :verify="verify"
          title="Enter your PIN"
          @verified="onVerified"
          @cancel="emit('close')"
        />
      </template>
    </div>
  </RSheet>
</template>
