<script setup lang="ts">
/**
 * Full-screen Night Mode (spec §7.7): a dim clock over a slow radial gradient. Tapping anywhere calls
 * `peek()` (via the parent's `modes.peek()`), which shows the dimmed main screen for 60 s.
 * With photos (Phase 3c) this will crossfade a slideshow; for now it's the clock alone.
 */
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
    <div
      class="absolute inset-0"
      style="background: radial-gradient(ellipse at 30% 40%, #3a2a24 0%, #1a1412 55%, #0e0b0a 100%)"
      aria-hidden="true"
    />
    <div class="relative flex h-full flex-col items-center justify-center gap-3">
      <p class="text-[64px] font-medium leading-none tabular-nums" style="color: rgba(233, 223, 209, 0.55)">
        {{ clock }}
      </p>
      <p class="text-[18px]" style="color: rgba(233, 223, 209, 0.35)">{{ date }}</p>
    </div>
  </div>
</template>
