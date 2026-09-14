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

/** The picked child's open sleep in the live view (including this display's unsynced logs). */
const liveOpenSleep = computed(() => (view.value && childId.value ? openSleepFor(view.value, childId.value) : null))

/** Identity of an open sleep for change detection (never object identity: every view rebuild makes new objects). */
function sleepKey(entry: SleepEntry | null): string | null {
  return entry ? `${entry.id}|${entry.startAt}|${entry.endAt}` : null
}

/**
 * The open sleep the sheet is acting on. Re-read from the live view on open, on switching child and when a
 * failed save ends; frozen while saving (and after a successful save until the sheet closes) so this
 * display's own optimistic update doesn't flip the mode under the adult.
 */
const openSleep = ref<SleepEntry | null>(null)
/** True from a save's start until the sheet next opens (a successful save closes it) or the save fails. */
const saving = ref(false)
/** Shown when another display changed this child's sleep while the sheet was open. */
const modeNotice = ref<string | null>(null)
/** After such a change, the next tap on the action button only acknowledges it: it was aimed at the old mode. */
const needsFreshTap = ref(false)

const minAt = computed(() =>
  openSleep.value ? openSleep.value.startAt : new Date(now.value.getTime() - LOOKBACK_MS).toISOString(),
)
const sleepingSince = computed(() => (openSleep.value ? formatClock(new Date(openSleep.value.startAt), tz.value) : ''))

function autoType(): string | null {
  if (!view.value || !child.value) return null
  const window = nightWindowFor(child.value, view.value.household.defaultNightSleep)
  return classifySleep(new Date(at.value), window, tz.value)
}

function clampAt(): void {
  const atMs = Date.parse(at.value)
  const minMs = Date.parse(minAt.value)
  const maxMs = now.value.getTime()
  if (atMs < minMs) at.value = new Date(minMs).toISOString()
  else if (atMs > maxMs) at.value = new Date(maxMs).toISOString()
}

/** Adopts the live open sleep. With `announce`, a change of mode (or of which sleep would be ended) is shown. */
function adoptLiveOpenSleep(announce: boolean): void {
  const live = liveOpenSleep.value
  const current = openSleep.value
  if (sleepKey(live) === sleepKey(current)) return
  const visibleChange = (live === null) !== (current === null) || (live !== null && current !== null && live.id !== current.id)
  openSleep.value = live
  clampAt()
  if (announce && visibleChange && child.value) {
    modeNotice.value = `Another display just updated ${child.value.name}'s sleep.`
    needsFreshTap.value = true
  }
}

// Switching child: re-derive the type, adopt that child's open sleep and keep the time inside the new bounds
// (an open sleep's start is the minimum). Otherwise a changed open sleep came from elsewhere: announce it.
watch([childId, () => sleepKey(liveOpenSleep.value)], ([nextChild], [prevChild]) => {
  if (nextChild !== prevChild) {
    typeTouched.value = false
    modeNotice.value = null
    needsFreshTap.value = false
    openSleep.value = liveOpenSleep.value
    if (Date.parse(at.value) < Date.parse(minAt.value) || Date.parse(at.value) > now.value.getTime()) at.value = now.value.toISOString()
    return
  }
  if (!props.open || saving.value) return
  adoptLiveOpenSleep(true)
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
    saving.value = false
    modeNotice.value = null
    needsFreshTap.value = false
    clearError()
    childId.value = defaultChildId(children.value)
    openSleep.value = liveOpenSleep.value
    type.value = autoType()
  },
  { immediate: true },
)

function onTypeChange(value: string | null): void {
  type.value = value
  typeTouched.value = true
}

const canSave = computed(() => !busy.value && !saving.value && child.value !== null && (openSleep.value !== null || type.value !== null))

async function save(): Promise<void> {
  if (!view.value || !child.value || !canSave.value) return
  if (needsFreshTap.value) {
    needsFreshTap.value = false
    return
  }
  const householdId = view.value.household.id
  let cmd: LogCommand
  if (openSleep.value) {
    // Never end a sleep before it started.
    if (Date.parse(at.value) < Date.parse(openSleep.value.startAt)) {
      clampAt()
      return
    }
    cmd = { kind: 'sleep.end', householdId, entryId: openSleep.value.id, endAt: at.value, previousEndAt: openSleep.value.endAt }
  } else {
    cmd = {
      kind: 'sleep.start',
      householdId,
      entry: { id: newId(), childId: child.value.id, startAt: at.value, endAt: null, type: type.value as 'nap' | 'night' },
      attribution: attributionFor(identity.value, who.value, view.value.members),
    }
  }
  saving.value = true
  const result = await submit(cmd)
  if (result) {
    emit('saved', result)
    emit('close')
    return
  }
  // Failed: the optimistic update is gone. Anything else that changed meanwhile came from elsewhere.
  saving.value = false
  adoptLiveOpenSleep(true)
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
        <p v-if="modeNotice" role="status" data-testid="sleep-mode-notice" class="text-[18px] font-medium text-warn-ink">
          {{ modeNotice }}
        </p>
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
