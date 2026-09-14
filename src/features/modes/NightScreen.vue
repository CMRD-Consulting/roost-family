<script setup lang="ts">
/**
 * Full-screen Night Mode (spec §7.7): a dim clock over a slow radial gradient. Tapping anywhere calls
 * `peek()` (via the parent's `modes.peek()`), which shows the dimmed main screen for 60 s.
 * With photos (Phase 3c) this will crossfade a slideshow; for now it's the clock alone.
 */
import { NIGHT_CLOCK_ALPHA, NIGHT_DATE_ALPHA, NIGHT_GRADIENT, nightText } from './nightColors'

defineProps<{ clock: string; date: string }>()
const emit = defineEmits<{ peek: [] }>()
</script>

<template>
  <div
    data-testid="night-screen"
    role="button"
    tabindex="0"
    aria-label="Show main screen"
    class="absolute inset-0 cursor-pointer bg-night outline-none"
    @click="emit('peek')"
    @keydown.enter.prevent="emit('peek')"
    @keydown.space.prevent="emit('peek')"
  >
    <div data-testid="night-gradient" class="absolute inset-0" :style="{ background: NIGHT_GRADIENT }" aria-hidden="true" />
    <div class="relative flex h-full flex-col items-center justify-center gap-3">
      <p class="text-[64px] font-medium leading-none tabular-nums" :style="{ color: nightText(NIGHT_CLOCK_ALPHA) }">
        {{ clock }}
      </p>
      <!-- Dim, but at least 3:1 against the gradient (see nightColors.ts). -->
      <p data-testid="night-date" class="text-[18px]" :style="{ color: nightText(NIGHT_DATE_ALPHA) }">{{ date }}</p>
    </div>
  </div>
</template>
