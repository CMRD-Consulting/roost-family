<script setup lang="ts">
/**
 * Dimmed peek (spec §7.7): after a tap on the Night screen, the screen underneath shows through a dark,
 * click-through overlay for 60 s (restarted by each tap), with a live countdown until the Night screen returns.
 * An open sheet holds Night Mode off past the countdown.
 */
import { computed } from 'vue'

const props = defineProps<{ until: number | null; now: Date }>()

/**
 * "back in 0:42" until the peek ends and Night Mode resumes; once the peek has run out while an open sheet
 * still holds Night Mode off, "when you're done".
 */
const status = computed(() => {
  const remainingMs = props.until === null ? 0 : props.until - props.now.getTime()
  if (remainingMs <= 0) return "when you're done"
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `back in ${minutes}:${String(seconds).padStart(2, '0')}`
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-10" style="background: rgba(43, 33, 28, 0.55)" aria-hidden="true" />
  <span
    data-testid="night-peek-chip"
    role="status"
    class="pointer-events-none absolute left-1/2 top-9 z-20 -translate-x-1/2 rounded-lg bg-surface-2 px-3 py-1.5 text-[16px] font-medium text-ink-2"
  >
    Night Mode · {{ status }}
  </span>
</template>
