<script setup lang="ts">
/** ±5 minute time control (spec §7.4): clamps to [min, max], shows the clock time and a relative label. */
import { computed } from 'vue'
import { formatClock, formatDuration } from '@/domain/time'

const props = defineProps<{ min: string; max: string; timeZone: string }>()
const model = defineModel<string>({ required: true })

const STEP_MS = 5 * 60_000

const valueMs = computed(() => new Date(model.value).getTime())
const minMs = computed(() => new Date(props.min).getTime())
const maxMs = computed(() => new Date(props.max).getTime())

const clockLabel = computed(() => formatClock(new Date(model.value), props.timeZone))
const relativeLabel = computed(() => {
  const diff = Date.now() - valueMs.value
  return diff < 60_000 ? 'now' : `${formatDuration(diff)} ago`
})

const atMin = computed(() => valueMs.value <= minMs.value)
const atMax = computed(() => valueMs.value >= maxMs.value)

function step(deltaMs: number): void {
  const next = Math.min(maxMs.value, Math.max(minMs.value, valueMs.value + deltaMs))
  model.value = new Date(next).toISOString()
}
</script>

<template>
  <div class="flex items-center gap-4">
    <button
      type="button"
      :disabled="atMin"
      class="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-[var(--radius-control)] bg-surface-2 px-4 text-[18px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
      @click="step(-STEP_MS)"
    >
      −5 min
    </button>
    <div class="flex min-w-[130px] flex-col items-center">
      <span class="text-[26px] font-semibold tabular-nums text-ink">{{ clockLabel }}</span>
      <span class="text-[18px] text-ink-3">{{ relativeLabel }}</span>
    </div>
    <button
      type="button"
      :disabled="atMax"
      class="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-[var(--radius-control)] bg-surface-2 px-4 text-[18px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
      @click="step(STEP_MS)"
    >
      +5 min
    </button>
  </div>
</template>
