<script setup lang="ts">
/**
 * PIN-guarded dose actions (spec §7.3): acknowledging an offline-dose conflict alert, and undoing a
 * just-logged dose (a void with a fixed reason; doses are never deleted, §11.4). Both are checked on the
 * server, so they need a connection. The dose id is fixed when the dialog opens, so the 10-second undo
 * window running out while an adult types their PIN doesn't matter.
 *
 * Undoing a dose that is still waiting in the offline queue never reached the server: after the PIN it is
 * just removed from the queue, and while offline it is removed straight away, without a PIN.
 */
import { computed, ref, watch } from 'vue'
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
/** Set once an unsynced dose has been removed without a PIN (offline). */
const removedUnsynced = ref(false)
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
    removedUnsynced.value = false
    padKey.value++
  },
  { immediate: true },
)

// Offline, a dose that never synced can be taken back without the server (and so without a PIN).
watch(
  () => [props.open, offline.value, logStore.pendingCount] as const,
  async ([open, isOffline]) => {
    if (!open || !isOffline || props.action !== 'undo' || props.doseId === null || pending.value) return
    if (!logStore.isDoseUnsent(props.doseId)) return
    pending.value = true
    try {
      if ((await logStore.undoDose(props.doseId, null)) === 'removed') {
        removedUnsynced.value = true
        emit('done')
      }
    } catch {
      error.value = copy.value.failed
    } finally {
      pending.value = false
    }
  },
  { immediate: true },
)

function verify(membershipId: string, pin: string): Promise<boolean> {
  return logStore.verifyPin(membershipId, pin)
}

async function onVerified({ membershipId, pin }: { membershipId: string; pin: string }): Promise<void> {
  if (!view.value || props.doseId === null || pending.value) return
  const householdId = view.value.household.id
  const doseId = props.doseId
  pending.value = true
  error.value = null
  try {
    if (props.action === 'acknowledge') {
      await logStore.submit({ kind: 'dose.acknowledge', householdId, doseId, membershipId, pin })
    } else {
      // Removes it if it never left the queue; waits for it if it's being sent; otherwise voids it.
      await logStore.undoDose(doseId, { kind: 'dose.void', householdId, doseId, membershipId, pin, reason: UNDO_DOSE_REASON })
    }
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
      <template v-if="removedUnsynced">
        <p role="status" class="text-[22px] text-ink">This dose hadn't synced yet — removed.</p>
        <RButton variant="secondary" tier="moment" class="w-full" @click="emit('close')">Close</RButton>
      </template>
      <template v-else-if="offline">
        <SheetError :message="error" />
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
