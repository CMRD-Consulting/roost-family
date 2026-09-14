<script setup lang="ts">
/** Multi-select weekday chips, Sunday first (spec §7.5): each chip is a toggle button named by the full day. */
import { WEEKDAY_LONG, WEEKDAY_SHORT } from '../routineForm'

defineProps<{ label: string }>()
const model = defineModel<number[]>({ required: true })

function toggle(day: number): void {
  model.value = model.value.includes(day)
    ? model.value.filter((d) => d !== day)
    : [...model.value, day].sort((a, b) => a - b)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-[18px] font-medium text-ink-2" aria-hidden="true">{{ label }}</span>
    <div role="group" :aria-label="label" class="flex flex-wrap gap-2">
      <button
        v-for="(short, day) in WEEKDAY_SHORT"
        :key="day"
        type="button"
        :aria-label="WEEKDAY_LONG[day]"
        :aria-pressed="model.includes(day)"
        class="min-h-[48px] min-w-[64px] rounded-[var(--radius-control)] px-4 text-[18px] font-medium transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
        :class="model.includes(day) ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
        @click="toggle(day)"
      >
        {{ short }}
      </button>
    </div>
  </div>
</template>
