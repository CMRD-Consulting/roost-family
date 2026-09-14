<script setup lang="ts">
/**
 * Starts Sitter Mode (spec §7.3, §7.6): an adult's PIN, then an optional sitter name. The PIN is checked on the
 * server, so this needs a connection. After it starts, the household is reloaded so the server's session id
 * replaces the optimistic one before anyone can end it.
 */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import { LogWriteError } from '@/data/logWriter'
import SheetError from '@/features/logs/SheetError.vue'
import { useLogSheet } from '@/features/logs/useLogSheet'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'
import { sitterLabel } from './sitterModel'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const OFFLINE_MESSAGE = 'Connect to start Sitter Mode.'

const householdStore = useHouseholdStore()
const logStore = useLogStore()
const { view, displayId } = useLogSheet()

const members = computed(() => view.value?.members ?? [])
/** Set once an adult's PIN has been verified: the name step. */
const verified = ref<{ membershipId: string; pin: string } | null>(null)
const name = ref('')
const pending = ref(false)
const error = ref<string | null>(null)
const padKey = ref(0)

const offline = computed(
  () => householdStore.online === false || (typeof navigator !== 'undefined' && navigator.onLine === false),
)
const entriesLabel = computed(() => sitterLabel({ sitterName: name.value }))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    verified.value = null
    name.value = ''
    pending.value = false
    error.value = null
    padKey.value++
  },
  { immediate: true },
)

function verify(membershipId: string, pin: string): Promise<boolean> {
  return logStore.verifyPin(membershipId, pin)
}

async function start(): Promise<void> {
  if (!view.value || !verified.value || pending.value) return
  pending.value = true
  error.value = null
  try {
    await logStore.submit({
      kind: 'sitter.start',
      householdId: view.value.household.id,
      sessionId: newId(),
      membershipId: verified.value.membershipId,
      pin: verified.value.pin,
      sitterName: name.value.trim() || null,
      displayId: displayId.value,
      startedAt: new Date().toISOString(),
    })
  } catch (e) {
    if (e instanceof LogWriteError && e.network) error.value = OFFLINE_MESSAGE
    else if (e instanceof LogWriteError && e.code === '23505') error.value = 'Sitter Mode is already on.'
    else error.value = "Couldn't start Sitter Mode. Try again."
    return
  } finally {
    pending.value = false
  }
  void householdStore.reload()
  emit('close')
}
</script>

<template>
  <RSheet title="Start Sitter Mode" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-6">
      <template v-if="offline">
        <p role="status" class="text-[22px] text-ink">{{ OFFLINE_MESSAGE }}</p>
        <RButton variant="secondary" tier="moment" class="w-full" @click="emit('close')">Close</RButton>
      </template>

      <template v-else-if="verified">
        <div class="flex flex-col gap-2">
          <h3 class="text-[28px] font-semibold text-ink">Who's watching the kids?</h3>
          <p class="text-[18px] text-ink-3">Optional. Their entries will show as "{{ entriesLabel }}".</p>
        </div>
        <RInput v-model="name" label="Sitter's name (optional)" placeholder="Grandma, Jess…" :maxlength="40" autocomplete="off" />
        <SheetError :message="error" />
      </template>

      <div v-else class="flex flex-col items-center gap-6">
        <SheetError :message="error" />
        <RPinPad
          :key="padKey"
          :members="members"
          :verify="verify"
          title="Enter your PIN"
          @verified="verified = $event"
          @cancel="emit('close')"
        />
      </div>
    </div>

    <template v-if="verified && !offline" #footer>
      <RButton tier="moment" class="w-full" :disabled="pending" @click="start">Start Sitter Mode</RButton>
    </template>
  </RSheet>
</template>
