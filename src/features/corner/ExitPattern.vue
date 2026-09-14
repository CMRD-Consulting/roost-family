<script setup lang="ts">
/**
 * Offline way out of Kids' Corner (spec §7.3, §13): when an adult PIN can't be checked, four numbered dots sit
 * at random spots and an adult taps 1, 2, 3, 4 in order within 10 s. Adults read the numbers; pre-readers
 * typically can't put them in sequence. A tap out of order, or running out of time, starts over.
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { EXIT_PATTERN_RNG, PATTERN_WINDOW_MS, patternDots, startPattern, tapPatternDot } from './cornerExit'

const emit = defineEmits<{ complete: [] }>()

const rng = inject(EXIT_PATTERN_RNG, Math.random)
/** Placed once per opening of the exit sheet. */
const dots = patternDots(rng)
const state = ref(startPattern())
const tapped = computed(() => state.value.next - 1)

let expiry: ReturnType<typeof setTimeout> | undefined

function tap(n: number): void {
  const result = tapPatternDot(state.value, n, Date.now())
  const wasStarted = state.value.startedAt
  state.value = result.state
  if (result.complete) {
    clearTimeout(expiry)
    emit('complete')
    return
  }
  // Show the reset when the 10 s run out, not only on the next tap.
  if (result.state.startedAt !== wasStarted) {
    clearTimeout(expiry)
    if (result.state.startedAt !== null) expiry = setTimeout(() => (state.value = startPattern()), PATTERN_WINDOW_MS + 1)
  }
}

onBeforeUnmount(() => clearTimeout(expiry))
</script>

<template>
  <div class="flex flex-col gap-4">
    <p data-testid="pattern-instruction" class="text-center text-[22px] font-medium text-ink">Adults: tap 1, 2, 3, 4 in order</p>
    <div class="relative h-[300px] w-full rounded-[var(--radius-card)] bg-surface-2">
      <button
        v-for="dot in dots"
        :key="dot.n"
        type="button"
        data-testid="pattern-dot"
        :data-tapped="dot.n <= tapped || undefined"
        class="absolute flex size-[88px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[32px] font-semibold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :class="dot.n <= tapped ? 'bg-ink text-surface' : 'bg-surface text-ink'"
        :style="{ left: `${dot.x}%`, top: `${dot.y}%` }"
        @click="tap(dot.n)"
      >
        {{ dot.n }}
      </button>
    </div>
  </div>
</template>
