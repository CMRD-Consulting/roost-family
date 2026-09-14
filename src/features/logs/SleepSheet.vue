<script setup lang="ts">
/** Start or end a child's sleep (spec §7.4). Type is auto-classified from the child's night window until changed. */
import { computed, ref, watch } from 'vue'
import { newId, type LogCommand } from '@/data/logCommands'
import { classifySleep, nightWindowFor } from '@/domain/sleep'
import { formatClock } from '@/domain/time'
import type { SleepEntry } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import ChildPicker from './ChildPicker.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import WhoRow from './WhoRow.vue'
import { attributionFor, defaultChildId, eligibleChildren, openSleepFor } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const LOOKBACK_MS = 12 * 3_600_000
const TYPE_OPTIONS = [
  { value: 'nap', label: 'Nap' },
  { value: 'night', label: 'Night' },
]

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const now = ref(new Date())
const childId = ref<string | null>(null)
const who = ref<string | null>(null)
const at = ref(now.value.toISOString())
const type = ref<string | null>(null)
const typeTouched = ref(false)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const children = computed(() => (view.value ? eligibleChildren(view.value, 'sleep', now.value) : []))
const child = computed(() => children.value.find((c) => c.id === childId.value) ?? null)

/** The picked child's open sleep. Frozen while saving so the optimistic update doesn't flip the sheet's mode. */
const openSleep = ref<SleepEntry | null>(null)
watch(
  () => (view.value && childId.value ? openSleepFor(view.value, childId.value) : null),
  (entry) => {
    if (!busy.value) openSleep.value = entry
  },
  { immediate: true },
)

const minAt = computed(() =>
  openSleep.value ? openSleep.value.startAt : new Date(now.value.getTime() - LOOKBACK_MS).toISOString(),
)
const sleepingSince = computed(() => (openSleep.value ? formatClock(new Date(openSleep.value.startAt), tz.value) : ''))

function autoType(): string | null {
  if (!view.value || !child.value) return null
  const window = nightWindowFor(child.value, view.value.household.defaultNightSleep)
  return classifySleep(new Date(at.value), window, tz.value)
}

// Switching child: re-derive the type and keep the time inside the new bounds (an open sleep's start is the minimum).
watch(childId, () => {
  typeTouched.value = false
  const atMs = Date.parse(at.value)
  if (atMs < Date.parse(minAt.value) || atMs > now.value.getTime()) at.value = now.value.toISOString()
})

watch([at, childId], () => {
  if (!typeTouched.value) type.value = autoType()
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    now.value = new Date()
    at.value = now.value.toISOString()
    who.value = null
    typeTouched.value = false
    clearError()
    childId.value = defaultChildId(children.value)
    type.value = autoType()
  },
  { immediate: true },
)

function onTypeChange(value: string | null): void {
  type.value = value
  typeTouched.value = true
}

const canSave = computed(() => !busy.value && child.value !== null && (openSleep.value !== null || type.value !== null))

async function save(): Promise<void> {
  if (!view.value || !child.value || !canSave.value) return
  const householdId = view.value.household.id
  let cmd: LogCommand
  if (openSleep.value) {
    cmd = { kind: 'sleep.end', householdId, entryId: openSleep.value.id, endAt: at.value, previousEndAt: openSleep.value.endAt }
  } else {
    cmd = {
      kind: 'sleep.start',
      householdId,
      entry: { id: newId(), childId: child.value.id, startAt: at.value, endAt: null, type: type.value as 'nap' | 'night' },
      attribution: attributionFor(identity.value, who.value, view.value.members),
    }
  }
  const result = await submit(cmd)
  if (result) {
    emit('saved', result)
    emit('close')
  }
}
</script>

<template>
  <RSheet title="Sleep" :open="open" @close="emit('close')">
    <div v-if="view" class="flex flex-col gap-6">
      <ChildPicker v-model="childId" :children="children">
        <template #empty>
          <p class="text-[22px] text-ink-2">No children have sleep tracking turned on.</p>
        </template>
      </ChildPicker>

      <template v-if="child">
        <template v-if="openSleep">
          <p class="text-[26px] font-semibold text-ink">Sleeping since {{ sleepingSince }}</p>
          <div class="flex flex-col gap-2">
            <SheetLabel>Woke up</SheetLabel>
            <RTimeStepper v-model="at" :min="minAt" :max="now.toISOString()" :time-zone="tz" />
          </div>
        </template>
        <template v-else>
          <div class="flex flex-col gap-2">
            <SheetLabel>Fell asleep</SheetLabel>
            <RTimeStepper v-model="at" :min="minAt" :max="now.toISOString()" :time-zone="tz" />
          </div>
          <div class="flex flex-col gap-2">
            <SheetLabel>Type</SheetLabel>
            <RChips :model-value="type" :options="TYPE_OPTIONS" label="Sleep type" @update:model-value="onTypeChange" />
          </div>
          <WhoRow v-model="who" :members="view.members" :required="false" />
        </template>
      </template>

      <SheetError :message="error" />
    </div>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">
        {{ openSleep ? 'End sleep' : 'Start sleep' }}
      </RButton>
    </template>
  </RSheet>
</template>
