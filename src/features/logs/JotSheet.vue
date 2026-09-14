<script setup lang="ts">
/** Jot it (spec §7.4): one text field saved to the Inbox, attributed to the display only (§6.5). */
import { computed, ref, useId, watch } from 'vue'
import { newId } from '@/data/logCommands'
import RButton from '@/ui/RButton.vue'
import RSheet from '@/ui/RSheet.vue'
import SheetError from './SheetError.vue'
import { useLogSheet, type SaveResult } from './useLogSheet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const MAX_LENGTH = 500

const { view, displayId, busy, error, submit, clearError } = useLogSheet()
const textId = useId()
const text = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    text.value = ''
    clearError()
  },
  { immediate: true },
)

const canSave = computed(() => !busy.value && text.value.trim().length > 0)

async function save(): Promise<void> {
  if (!view.value || !canSave.value) return
  const result = await submit({
    kind: 'jot.add',
    householdId: view.value.household.id,
    jot: { id: newId(), text: text.value.trim().slice(0, MAX_LENGTH), createdAt: new Date().toISOString(), doneAt: null },
    displayId: displayId.value,
  })
  if (result) {
    emit('saved', result)
    emit('close')
  }
}
</script>

<template>
  <RSheet title="Jot it" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <label :for="textId" class="text-[22px] font-medium text-ink">What do you want to remember?</label>
      <textarea
        :id="textId"
        v-model="text"
        :maxlength="MAX_LENGTH"
        rows="4"
        class="min-h-[140px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 py-3 text-[24px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
      />
      <SheetError :message="error" />
    </div>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">Save</RButton>
    </template>
  </RSheet>
</template>
