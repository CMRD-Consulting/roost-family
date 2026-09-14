<script setup lang="ts">
/** A labelled multi-line text field with an optional hint. */
import { useId } from 'vue'

withDefaults(defineProps<{ label: string; hint?: string; maxlength?: number; rows?: number }>(), { rows: 3 })
const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <div class="flex flex-col gap-2">
    <label :for="id" class="text-[18px] font-medium text-ink-2">{{ label }}</label>
    <p v-if="hint" :id="`${id}-hint`" class="text-[18px] text-ink-3">{{ hint }}</p>
    <textarea
      :id="id"
      v-model="model"
      :rows="rows"
      :maxlength="maxlength"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      class="min-h-[56px] resize-y rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 py-3 text-[20px] leading-snug text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    />
  </div>
</template>
