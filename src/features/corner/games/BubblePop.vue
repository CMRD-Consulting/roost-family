<script setup lang="ts">
/**
 * Bubbles (Kids' Corner games, spec §7.5): bubbles in the child's colour drift slowly up the screen; a tap
 * pops one with a plink (silent in Nap and Night Mode) and a fresh bubble floats in from below. Pure cause and
 * effect, and just as satisfying without sound. With Reduce Motion nothing drifts: bubbles sit still and a
 * popped one reappears somewhere else.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { playPop } from '@/ui/sound'
import { initialBubbles, replaceBubble, stepBubbles, swayedX, type Bubble } from './bubbles'

const props = defineProps<{ color: string }>()

/** How long the pop animation shows before the bubble is replaced. */
const POP_MS = 220

const rng = Math.random
const reducedMotion = ref(false)
const bubbles = ref<Bubble[]>(initialBubbles(rng))
const popping = ref(new Set<number>())
let nextId = bubbles.value.length + 1
let frame: number | undefined
let lastFrameAt = 0
const popTimers = new Set<ReturnType<typeof setTimeout>>()

function tick(now: number): void {
  frame = undefined
  if (lastFrameAt !== 0) {
    // A long gap (the tab was hidden) is clamped so bubbles don't all leap off the top at once.
    const dt = Math.min(now - lastFrameAt, 100)
    const stepped = stepBubbles(bubbles.value, dt, rng, nextId)
    bubbles.value = stepped.bubbles
    nextId = stepped.nextId
  }
  lastFrameAt = now
  frame = requestAnimationFrame(tick)
}

function startDrift(): void {
  if (reducedMotion.value || frame !== undefined) return
  lastFrameAt = 0
  frame = requestAnimationFrame(tick)
}

function stopDrift(): void {
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') startDrift()
  else stopDrift()
}

function pop(id: number): void {
  if (popping.value.has(id)) return
  playPop()
  popping.value = new Set(popping.value).add(id)
  const timer = setTimeout(() => {
    popTimers.delete(timer)
    const next = new Set(popping.value)
    next.delete(id)
    popping.value = next
    const replaced = replaceBubble(bubbles.value, id, rng, nextId, reducedMotion.value)
    bubbles.value = replaced.bubbles
    nextId = replaced.nextId
  }, POP_MS)
  popTimers.add(timer)
}

function bubbleStyle(b: Bubble): Record<string, string> {
  return {
    left: `${swayedX(b)}%`,
    top: `${b.y}%`,
    width: `${b.size}px`,
    height: `${b.size}px`,
    '--bubble-color': props.color,
  }
}

onMounted(() => {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  document.addEventListener('visibilitychange', onVisibilityChange)
  startDrift()
})

onBeforeUnmount(() => {
  stopDrift()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  for (const timer of popTimers) clearTimeout(timer)
})
</script>

<template>
  <section data-testid="game-bubbles" class="relative h-full overflow-hidden" aria-label="Bubbles">
    <button
      v-for="b in bubbles"
      :key="b.id"
      type="button"
      data-testid="bubble"
      aria-label="Bubble"
      class="bubble absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
      :class="popping.has(b.id) && 'bubble--pop'"
      :style="bubbleStyle(b)"
      @pointerdown.prevent="pop(b.id)"
      @keydown.enter.prevent="pop(b.id)"
      @keydown.space.prevent="pop(b.id)"
    />
  </section>
</template>

<style scoped>
.bubble {
  --bubble-color: #2c7f8c;
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 1) 0 7%, rgba(255, 255, 255, 0) 28%),
    radial-gradient(circle at 70% 78%, rgba(255, 255, 255, 0.7) 0 4%, rgba(255, 255, 255, 0) 16%),
    radial-gradient(
      circle at 50% 50%,
      color-mix(in srgb, var(--bubble-color) 6%, white) 0%,
      color-mix(in srgb, var(--bubble-color) 14%, white) 62%,
      color-mix(in srgb, var(--bubble-color) 45%, white) 92%,
      color-mix(in srgb, var(--bubble-color) 70%, white) 100%
    );
  border: 2px solid color-mix(in srgb, var(--bubble-color) 55%, white);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--bubble-color) 22%, transparent);
  touch-action: none;
}
.bubble--pop {
  animation: bubble-pop 220ms ease-out both;
  pointer-events: none;
}
@keyframes bubble-pop {
  to {
    transform: translate(-50%, -50%) scale(1.35);
    opacity: 0;
  }
}
</style>
