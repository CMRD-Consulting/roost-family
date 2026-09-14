<script setup lang="ts">
/**
 * Visual timer (spec §7.5): picture presets start it with a tap; a big disc empties clockwise as time passes;
 * a chime plays at zero (via the timer state) and the disc pulses until it resets. Stopping is a long-press.
 * The state lives in the Corner shell (`useVisualTimer`) so it survives switching tabs.
 */
import { computed } from 'vue'
import RLongPress from '@/ui/RLongPress.vue'
import type { VisualTimer } from './useVisualTimer'

const props = defineProps<{ timer: VisualTimer }>()

const PRESETS = [1, 2, 5, 10] as const
/** The presets' pies show their share of the longest preset. */
const LONGEST = 10

/** An SVG path for a pie wedge of `share` (0–1] of a 24-unit circle, starting at 12 o'clock. */
function wedge(share: number): string {
  if (share >= 1) return 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20z'
  const angle = share * 2 * Math.PI
  const x = 12 + 10 * Math.sin(angle)
  const y = 12 - 10 * Math.cos(angle)
  return `M12 12L12 2A10 10 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}z`
}

const phase = computed(() => props.timer.phase.value)
const discStyle = computed(() => ({ '--timer-left': String(props.timer.fraction.value) }))
</script>

<template>
  <section class="flex h-full flex-wrap items-center justify-center gap-x-16 gap-y-8 px-10 py-6">
    <div
      data-testid="timer-disc"
      :data-phase="phase"
      class="timer-disc flex shrink-0 items-center justify-center rounded-full"
      :class="phase === 'finished' && 'timer-disc--finished'"
      :style="discStyle"
    >
      <div class="flex size-[40%] items-center justify-center rounded-full bg-corner text-ink-2">
        <span v-if="phase !== 'idle'" data-testid="timer-digits" class="text-[40px] font-semibold tabular-nums">
          {{ timer.label.value }}
        </span>
        <svg v-else width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4" />
        </svg>
      </div>
    </div>

    <div v-if="phase === 'running'" class="flex flex-col items-center gap-3">
      <RLongPress
        aria-label="Stop timer"
        class="flex size-[140px] items-center justify-center rounded-full border-4 border-amber bg-corner-tile text-amber-deep focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
        @complete="timer.cancel()"
      >
        <span class="r-longpress-ring absolute -inset-2" aria-hidden="true" />
        <svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
        </svg>
      </RLongPress>
    </div>

    <ul v-else class="grid grid-cols-2 gap-5">
      <li v-for="minutes in PRESETS" :key="minutes">
        <button
          type="button"
          :aria-label="minutes === 1 ? '1 minute' : `${minutes} minutes`"
          class="flex size-[150px] flex-col items-center justify-center gap-1 rounded-[28px] bg-corner-tile text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          @click="timer.start(minutes)"
        >
          <svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="var(--color-corner)" stroke="var(--color-orange)" stroke-width="1.2" />
            <path :d="wedge(minutes / LONGEST)" fill="var(--color-orange)" />
          </svg>
          <span class="text-[36px] font-semibold leading-none" aria-hidden="true">{{ minutes }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.timer-disc {
  --timer-left: 0;
  width: min(60vh, 60vw);
  height: min(60vh, 60vw);
  /* Empties clockwise from 12 o'clock: the used share is the tile colour, what's left is orange. */
  background: conic-gradient(var(--color-corner-tile) calc((1 - var(--timer-left)) * 1turn), var(--color-orange) 0);
  box-shadow: 0 20px 60px rgba(226, 112, 58, 0.25);
}
.timer-disc--finished {
  animation: timer-pulse 1.2s ease-in-out 4;
}
@keyframes timer-pulse {
  50% {
    transform: scale(1.04);
    box-shadow: 0 20px 80px rgba(226, 112, 58, 0.5);
  }
}
</style>
