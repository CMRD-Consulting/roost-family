<script setup lang="ts">
/**
 * PIN-guarded dose actions (spec §7.3): acknowledging an offline-dose conflict alert, and undoing a
 * just-logged dose (a void with a fixed reason; doses are never deleted, §11.4). Both are checked on the
 * server, so they need a connection. The dose id is fixed when the dialog opens, so the 10-second undo
 * window running out while an adult types their PIN doesn't matter.
 */
import { computed, ref, watch } from 'vue'
import type { LogCommand } from '@/data/logCommands'
import { LogWriteError } from '@/data/logWriter'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import RButton from '@/ui/RButton.vue'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'
import SheetError from './SheetError.vue'
import { UNDO_DOSE_REASON } from './logSheetModel'

export type DosePinAction = 'acknowledge' | 'undo'

const props = defineProps<{ open: boolean; action: DosePinAction; doseId: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const householdStore = useHouseholdStore()
const logStore = useLogStore()

const COPY = {
  acknowledge: { title: 'Acknowledge dose alert', offline: 'Connect to acknowledge.', failed: "Couldn't acknowledge the alert. Try again." },
  undo: { title: 'Undo dose', offline: 'Connect to undo this dose.', failed: "Couldn't undo the dose. Try again." },
} as const

const copy = computed(() => COPY[props.action])
const view = computed(() => householdStore.view)
const members = computed(() => view.value?.members ?? [])

const pending = ref(false)
const error = ref<string | null>(null)
/** Bumped to reset the pad (back to choosing an adult) after a failed action. */
const padKey = ref(0)

const offline = computed(
  () => householdStore.online === false || (typeof navigator !== 'undefined' && navigator.onLine === false),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    error.value = null
    pending.value = false
    padKey.value++
  },
  { immediate: true },
)

function verify(membershipId: string, pin: string): Promise<boolean> {
  return logStore.verifyPin(membershipId, pin)
}

function commandFor(membershipId: string, pin: string): LogCommand | null {
  if (!view.value || props.doseId === null) return null
  const householdId = view.value.household.id
  return props.action === 'acknowledge'
    ? { kind: 'dose.acknowledge', householdId, doseId: props.doseId, membershipId, pin }
    : { kind: 'dose.void', householdId, doseId: props.doseId, membershipId, pin, reason: UNDO_DOSE_REASON }
}

async function onVerified({ membershipId, pin }: { membershipId: string; pin: string }): Promise<void> {
  const cmd = commandFor(membershipId, pin)
  if (cmd === null || pending.value) return
  pending.value = true
  error.value = null
  try {
    await logStore.submit(cmd)
  } catch (e) {
    // Network-class failures (no connection, expired session, dose not synced yet) can succeed later.
    if (e instanceof LogWriteError && e.network) error.value = copy.value.offline
    else error.value = copy.value.failed
    padKey.value++
    return
  } finally {
    pending.value = false
  }
  emit('done')
  emit('close')
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
