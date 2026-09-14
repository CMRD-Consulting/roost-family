<script setup lang="ts">
/**
 * Adult PIN for the end of Sitter Mode (spec §7.3, §7.6). `end` ends the household's active session and emits
 * `done` with its id, for the caller to show that session's summary. If another display already ended it, the household is
 * reloaded and `done` carries that session's id when its summary hasn't been shown anywhere yet (else `close`). `unlockSummary` only checks the PIN before
 * another display shows the summary of a session that has already ended. Both need a connection (the PIN is
 * checked on the server).
 */
import { computed, ref, watch } from 'vue'
import { LogWriteError } from '@/data/logWriter'
import { pendingSummary } from './sitterModel'
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

/** The session was already ended (22023) or is gone (42501 "not found"; the PIN itself was verified just before). */
function endedElsewhere(e: unknown): boolean {
  if (!(e instanceof LogWriteError)) return false
  return e.code === '22023' || (e.code === '42501' && /not found/i.test(e.message))
}

/** Sitter Mode was ended elsewhere: show its summary here if no display has shown it yet, else just close. */
function closeEndedElsewhere(): void {
  const view = householdStore.view
  const pending = view ? pendingSummary(view, new Date()) : null
  if (pending) emit('done', pending.id)
  else emit('close')
}

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

  // Read now, not when the dialog opened: another display may have ended or restarted Sitter Mode meanwhile.
  const session = view.activeSitterSession ?? null
  if (session === null) {
    // Already ended (e.g. on another display).
    closeEndedElsewhere()
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
    if (endedElsewhere(e)) {
      await householdStore.reload()
      closeEndedElsewhere()
      return
    }
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
