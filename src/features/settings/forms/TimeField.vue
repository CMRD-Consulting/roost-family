<script setup lang="ts">
/** A labelled time of day ('HH:MM', 24-hour value; the tablet shows it in its own clock format). */
import { useId } from 'vue'

defineProps<{ label: string; error?: string }>()
const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <div class="flex flex-col gap-2">
    <label :for="id" class="text-[18px] font-medium text-ink-2">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      type="time"
      step="60"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${id}-error` : undefined"
      class="min-h-[56px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink tabular-nums focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    />
    <p v-if="error" :id="`${id}-error`" class="text-[18px] text-warn-ink">{{ error }}</p>
  </div>
</template>
