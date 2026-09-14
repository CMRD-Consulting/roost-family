<script setup lang="ts">
/** Edit tonight's dinner line on the main screen. */
import { computed, ref, watch } from 'vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import SheetError from './SheetError.vue'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const MAX_LENGTH = 80

const { view, busy, error, submit, clearError } = useLogSheet()
const text = ref('')
const current = computed(() => view.value?.household.dinnerTonight ?? null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    text.value = current.value ?? ''
    clearError()
  },
  { immediate: true },
)

const trimmed = computed(() => text.value.trim().slice(0, MAX_LENGTH))
const canSave = computed(() => !busy.value && trimmed.value.length > 0 && trimmed.value !== current.value)
const canClear = computed(() => !busy.value && current.value !== null)

async function set(value: string | null): Promise<void> {
  if (!view.value) return
  const result = await submit({ kind: 'dinner.set', householdId: view.value.household.id, text: value, previous: current.value })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}

function save(): void {
  if (canSave.value) void set(trimmed.value)
}

function clear(): void {
  if (canClear.value) void set(null)
}
</script>

<template>
  <RSheet title="Dinner" :open="open" @close="emit('close')">
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <RInput v-model="text" label="Tonight's dinner" :maxlength="MAX_LENGTH" />
      <SheetError :message="error" />
    </form>

    <template #footer>
      <div class="flex gap-3">
        <RButton variant="secondary" tier="moment" class="flex-1" :disabled="!canClear" @click="clear">Clear</RButton>
        <RButton tier="moment" class="flex-[2]" :disabled="!canSave" @click="save">Save</RButton>
      </div>
    </template>
  </RSheet>
</template>
