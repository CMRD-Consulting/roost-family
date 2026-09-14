<script setup lang="ts">
/** Give a sticker (spec §7.4): category, time, optional "Who?"; saving plays the celebration before closing. */
import { computed, ref, watch } from 'vue'
import { newId } from '@/data/logCommands'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import ChildPicker from './ChildPicker.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import StickerCelebration from './StickerCelebration.vue'
import WhoRow from './WhoRow.vue'
import { attributionFor, defaultChildId, eligibleChildren } from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const LOOKBACK_MS = 12 * 3_600_000

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const now = ref(new Date())
const childId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const at = ref(now.value.toISOString())
const who = ref<string | null>(null)
/** Set after a successful save: the child's name to celebrate, and the save result to report when it ends. */
const celebration = ref<{ childName: string; result: SaveResult } | null>(null)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const children = computed(() => (view.value ? eligibleChildren(view.value, 'sticker', now.value) : []))
const child = computed(() => children.value.find((c) => c.id === childId.value) ?? null)
const minAt = computed(() => new Date(now.value.getTime() - LOOKBACK_MS).toISOString())
const categoryOptions = computed(() =>
  [...(view.value?.stickerCategories ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ value: c.id, label: c.name })),
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      celebration.value = null
      return
    }
    now.value = new Date()
    at.value = now.value.toISOString()
    categoryId.value = null
    who.value = null
    clearError()
    childId.value = defaultChildId(children.value)
  },
  { immediate: true },
)

const canSave = computed(() => !busy.value && child.value !== null && categoryId.value !== null)

async function save(): Promise<void> {
  if (!view.value || !child.value || !categoryId.value || !canSave.value) return
  const childName = child.value.name
  const result = await submit({
    kind: 'sticker.add',
    householdId: view.value.household.id,
    entry: { id: newId(), childId: child.value.id, categoryId: categoryId.value, at: at.value },
    attribution: attributionFor(identity.value, who.value, view.value.members),
  })
  if (result) celebration.value = { childName, result }
}

function onCelebrationDone(): void {
  const done = celebration.value
  celebration.value = null
  if (!done) return
  emit('saved', done.result)
  emit('close')
}
</script>

<template>
  <RSheet title="Sticker" :open="open && celebration === null" @close="emit('close')">
    <div v-if="view" class="flex flex-col gap-6">
      <ChildPicker v-model="childId" :children="children">
        <template #empty>
          <p class="text-[22px] text-ink-2">No children have stickers turned on.</p>
        </template>
      </ChildPicker>

      <template v-if="child">
        <div class="flex flex-col gap-2">
          <SheetLabel>For</SheetLabel>
          <RChips v-model="categoryId" :options="categoryOptions" label="Sticker category" />
        </div>
        <div class="flex flex-col gap-2">
          <SheetLabel>Time</SheetLabel>
          <RTimeStepper v-model="at" :min="minAt" :max="now.toISOString()" :time-zone="tz" />
        </div>
        <WhoRow v-model="who" :members="view.members" :required="false" />
      </template>

      <SheetError :message="error" />
    </div>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">Give sticker</RButton>
    </template>
  </RSheet>
  <StickerCelebration v-if="open && celebration" :child-name="celebration.childName" @done="onCelebrationDone" />
</template>
