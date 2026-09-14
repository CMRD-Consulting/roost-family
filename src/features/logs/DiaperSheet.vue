<script setup lang="ts">
/** Log a diaper change (spec §7.4): Wet / Dirty / Both, time, optional "Who?". */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import type { DiaperEntry } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import ChildPicker from './ChildPicker.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import WhoRow from './WhoRow.vue'
import { attributionFor, defaultChildId, eligibleChildren } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'
import { useSheetTime } from './useSheetTime'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const LOOKBACK_MS = 12 * 3_600_000
const KIND_OPTIONS = [
  { value: 'wet', label: 'Wet' },
  { value: 'dirty', label: 'Dirty' },
  { value: 'both', label: 'Both' },
]

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const { now, at, max, adjust, reset: resetTime, catchUp } = useSheetTime(() => minAt.value)
const childId = ref<string | null>(null)
const kind = ref<string | null>(null)
const who = ref<string | null>(null)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const children = computed(() => (view.value ? eligibleChildren(view.value, 'diaper', now.value) : []))
const child = computed(() => children.value.find((c) => c.id === childId.value) ?? null)
const minAt = computed(() => new Date(now.value.getTime() - LOOKBACK_MS).toISOString())

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetTime()
    kind.value = null
    who.value = null
    clearError()
    childId.value = defaultChildId(children.value)
  },
  { immediate: true },
)

const canSave = computed(() => !busy.value && child.value !== null && kind.value !== null)

async function save(): Promise<void> {
  catchUp()
  if (!view.value || !child.value || !kind.value || !canSave.value) return
  const result = await submit({
    kind: 'diaper.add',
    householdId: view.value.household.id,
    entry: { id: newId(), childId: child.value.id, at: at.value, kind: kind.value as DiaperEntry['kind'] },
    attribution: attributionFor(identity.value, who.value, view.value.members, view.value.activeSitterSession ?? null),
  })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}
</script>

<template>
  <RSheet title="Diaper" :open="open" @close="emit('close')">
    <div v-if="view" class="flex flex-col gap-6">
      <ChildPicker v-model="childId" :children="children">
        <template #empty>
          <p class="text-[22px] text-ink-2">Diaper logs are turned off.</p>
        </template>
      </ChildPicker>

      <template v-if="child">
        <RChips v-model="kind" :options="KIND_OPTIONS" label="Diaper" />
        <div class="flex flex-col gap-2">
          <SheetLabel>Time</SheetLabel>
          <RTimeStepper :model-value="at" :min="minAt" :max="max" :time-zone="tz" @update:model-value="adjust" />
        </div>
        <WhoRow v-model="who" :members="view.members" :required="false" :sitter="view.activeSitterSession ?? null" />
      </template>

      <SheetError :message="error" />
    </div>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">Save</RButton>
    </template>
  </RSheet>
</template>
