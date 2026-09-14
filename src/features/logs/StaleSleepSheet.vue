<script setup lang="ts">
/** "Still sleeping?" (spec §7.4): end a forgotten open sleep, or discard it after a confirmation step. */
import { computed, ref, watch } from 'vue'
import type { SleepEntry } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import { attributionFor, openSleepFor, startedAtLabel } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean; childId: string }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const now = ref(new Date())
const at = ref(now.value.toISOString())
const confirmingDiscard = ref(false)
/** Captured on open so the optimistic update doesn't blank the sheet while it saves. */
const entry = ref<SleepEntry | null>(null)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const child = computed(() => view.value?.children.find((c) => c.id === props.childId) ?? null)
const message = computed(() => {
  if (!entry.value || !child.value) return ''
  const started = startedAtLabel(new Date(entry.value.startAt), now.value, tz.value)
  return `${child.value.name}'s sleep started at ${started} and was never ended.`
})

watch(
  () => [props.open, props.childId] as const,
  ([open]) => {
    if (!open) return
    now.value = new Date()
    at.value = now.value.toISOString()
    confirmingDiscard.value = false
    clearError()
    entry.value = view.value ? openSleepFor(view.value, props.childId) : null
  },
  { immediate: true },
)

// Opened before the household finished loading: capture the entry once it arrives.
watch(
  () => view.value !== null,
  (ready) => {
    if (ready && props.open && entry.value === null && !busy.value) entry.value = openSleepFor(view.value!, props.childId)
  },
)

async function finish(cmd: Parameters<typeof submit>[0]): Promise<void> {
  const result = await submit(cmd)
  if (result) {
    emit('saved', result)
    emit('close')
  }
}

async function endSleep(): Promise<void> {
  if (!view.value || !entry.value || busy.value) return
  await finish({
    kind: 'sleep.end',
    householdId: view.value.household.id,
    entryId: entry.value.id,
    endAt: at.value,
    previousEndAt: entry.value.endAt,
  })
}

async function discard(): Promise<void> {
  if (!view.value || !entry.value || busy.value) return
  await finish({
    kind: 'sleep.discard',
    householdId: view.value.household.id,
    entry: entry.value,
    attribution: attributionFor(identity.value, null, view.value.members),
  })
}
</script>

<template>
  <RSheet title="Still sleeping?" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-6">
      <p v-if="!entry" class="text-[22px] text-ink-2">This sleep has already been ended.</p>
      <template v-else-if="confirmingDiscard">
        <p class="text-[22px] text-ink">Discard? This removes the sleep log.</p>
      </template>
      <template v-else>
        <p class="text-[22px] text-ink">{{ message }}</p>
        <div class="flex flex-col gap-2">
          <SheetLabel>Woke up</SheetLabel>
          <RTimeStepper v-model="at" :min="entry.startAt" :max="now.toISOString()" :time-zone="tz" />
        </div>
      </template>
      <SheetError :message="error" />
    </div>

    <template #footer>
      <div v-if="entry && confirmingDiscard" class="flex gap-3">
        <RButton variant="secondary" tier="moment" class="flex-1" :disabled="busy" @click="confirmingDiscard = false">
          Keep it
        </RButton>
        <RButton variant="danger" tier="moment" class="flex-1" :disabled="busy" @click="discard">Discard</RButton>
      </div>
      <div v-else-if="entry" class="flex gap-3">
        <RButton variant="danger" tier="moment" class="flex-1" :disabled="busy" @click="confirmingDiscard = true">
          Discard this sleep
        </RButton>
        <RButton tier="moment" class="flex-[2]" :disabled="busy" @click="endSleep">End sleep</RButton>
      </div>
      <RButton v-else variant="secondary" tier="moment" class="w-full" @click="emit('close')">Close</RButton>
    </template>
  </RSheet>
</template>
