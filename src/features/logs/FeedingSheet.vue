<script setup lang="ts">
/** Log a feeding (spec §7.4): type, optional amount and note, time, optional "Who?". */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import type { FeedingEntry } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import ChildPicker from './ChildPicker.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import WhoRow from './WhoRow.vue'
import { attributionFor, defaultChildId, eligibleChildren, feedingAmounts } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'
import { useSheetTime } from './useSheetTime'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const LOOKBACK_MS = 12 * 3_600_000
const TYPE_OPTIONS = [
  { value: 'milk', label: 'Milk' },
  { value: 'meal', label: 'Meal' },
  { value: 'snack', label: 'Snack' },
]

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const { now, at, max, adjust, reset: resetTime, catchUp } = useSheetTime(() => minAt.value)
const childId = ref<string | null>(null)
const type = ref<string | null>(null)
const amount = ref<string | null>(null)
const note = ref('')
const who = ref<string | null>(null)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const children = computed(() => (view.value ? eligibleChildren(view.value, 'feeding', now.value) : []))
const child = computed(() => children.value.find((c) => c.id === childId.value) ?? null)
const minAt = computed(() => new Date(now.value.getTime() - LOOKBACK_MS).toISOString())
const amountOptions = computed(() =>
  type.value ? feedingAmounts(type.value as FeedingEntry['type']).map((a) => ({ value: a, label: a })) : [],
)

watch(type, () => {
  if (amount.value !== null && !amountOptions.value.some((o) => o.value === amount.value)) amount.value = null
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetTime()
    type.value = null
    amount.value = null
    note.value = ''
    who.value = null
    clearError()
    childId.value = defaultChildId(children.value)
  },
  { immediate: true },
)

const canSave = computed(() => !busy.value && child.value !== null && type.value !== null)

async function save(): Promise<void> {
  catchUp()
  if (!view.value || !child.value || !type.value || !canSave.value) return
  const result = await submit({
    kind: 'feeding.add',
    householdId: view.value.household.id,
    entry: {
      id: newId(),
      childId: child.value.id,
      at: at.value,
      type: type.value as FeedingEntry['type'],
      amount: amount.value,
      note: note.value.trim() || null,
    },
    attribution: attributionFor(identity.value, who.value, view.value.members, view.value.activeSitterSession ?? null),
  })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}
</script>

<template>
  <RSheet title="Feeding" :open="open" @close="emit('close')">
    <div v-if="view" class="flex flex-col gap-6">
      <ChildPicker v-model="childId" :children="children">
        <template #empty>
          <p class="text-[22px] text-ink-2">No children have feeding logs turned on.</p>
        </template>
      </ChildPicker>

      <template v-if="child">
        <div class="flex flex-col gap-2">
          <SheetLabel>Type</SheetLabel>
          <RChips v-model="type" :options="TYPE_OPTIONS" label="Feeding type" />
        </div>
        <div v-if="type" class="flex flex-col gap-2">
          <SheetLabel>Amount (optional)</SheetLabel>
          <RChips v-model="amount" :options="amountOptions" label="Amount" deselectable />
        </div>
        <div class="flex flex-col gap-2">
          <SheetLabel>Time</SheetLabel>
          <RTimeStepper :model-value="at" :min="minAt" :max="max" :time-zone="tz" @update:model-value="adjust" />
        </div>
        <RInput v-model="note" label="Note (optional)" :maxlength="200" />
        <WhoRow v-model="who" :members="view.members" :required="false" :sitter="view.activeSitterSession ?? null" />
      </template>

      <SheetError :message="error" />
    </div>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">Save</RButton>
    </template>
  </RSheet>
</template>
