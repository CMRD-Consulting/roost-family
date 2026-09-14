<script setup lang="ts">
/** A number chosen with − and + buttons, clamped to `min`–`max` (deliberate surface: 48 px buttons). */
import { useId } from 'vue'

const props = withDefaults(
  defineProps<{ label: string; hint?: string; min: number; max: number; step?: number; unit?: string; error?: string }>(),
  { step: 1, unit: '' },
)
const model = defineModel<number>({ required: true })
const id = useId()

function change(delta: number): void {
  model.value = Math.min(props.max, Math.max(props.min, model.value + delta))
}
</script>

<template>
  <div role="group" :aria-labelledby="`${id}-label`" class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <span :id="`${id}-label`" class="text-[20px] font-medium text-ink">{{ label }}</span>
        <span v-if="hint" class="text-[18px] text-ink-3">{{ hint }}</span>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          :aria-label="`Decrease ${label}`"
          :disabled="model <= min"
          class="flex size-12 items-center justify-center rounded-[12px] bg-surface-2 text-[24px] text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
          @click="change(-step)"
        >
          −
        </button>
        <output :aria-labelledby="`${id}-label`" aria-live="polite" class="min-w-[96px] text-center text-[22px] font-semibold text-ink tabular-nums">
          {{ model }}{{ unit ? ` ${unit}` : '' }}
        </output>
        <button
          type="button"
          :aria-label="`Increase ${label}`"
          :disabled="model >= max"
          class="flex size-12 items-center justify-center rounded-[12px] bg-surface-2 text-[24px] text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
          @click="change(step)"
        >
          +
        </button>
      </div>
    </div>
    <p v-if="error" class="text-[18px] text-warn-ink">{{ error }}</p>
  </div>
</template>
