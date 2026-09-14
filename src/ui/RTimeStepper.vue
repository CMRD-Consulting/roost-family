<script setup lang="ts">
/**
 * ±5 minute time control (spec §7.4): clamps to [min, max], shows the clock time and a relative label
 * ("now", "5m ago") that stays current. A missing or unparseable bound means no bound on that side.
 */
import { computed } from 'vue'
import { useNow } from '@/composables/useNow'
import { formatClock, formatDuration } from '@/domain/time'

const props = defineProps<{ min?: string; max?: string; timeZone: string }>()
const model = defineModel<string>({ required: true })

const STEP_MS = 5 * 60_000

const now = useNow(30_000)

function parseBound(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

const valueMs = computed(() => new Date(model.value).getTime())
const minMs = computed(() => parseBound(props.min))
const maxMs = computed(() => parseBound(props.max))

const clockLabel = computed(() => formatClock(new Date(model.value), props.timeZone))
/** Null for a time in the future: there is nothing sensible to say besides the clock. */
const relativeLabel = computed<string | null>(() => {
  const diff = now.value.getTime() - valueMs.value
  if (diff < 0) return null
  return diff < 60_000 ? 'now' : `${formatDuration(diff)} ago`
})

const atMin = computed(() => minMs.value !== null && valueMs.value <= minMs.value)
const atMax = computed(() => maxMs.value !== null && valueMs.value >= maxMs.value)

function step(deltaMs: number): void {
  let next = valueMs.value + deltaMs
  if (maxMs.value !== null) next = Math.min(maxMs.value, next)
  if (minMs.value !== null) next = Math.max(minMs.value, next)
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
      <!-- Only the clock is live: the relative label ticks on its own and would chatter. -->
      <span aria-live="polite" class="text-[26px] font-semibold tabular-nums text-ink">{{ clockLabel }}</span>
      <span v-if="relativeLabel !== null" class="text-[18px] text-ink-3">{{ relativeLabel }}</span>
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
