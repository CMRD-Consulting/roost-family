<script setup lang="ts">
/**
 * Music (Kids' Corner games, spec §7.5): eight xylophone bars tuned to a pentatonic scale, so any taps make a
 * tune. A tap strikes a bar; sliding a finger across plays a glissando. Notes are synthesised in WebAudio
 * (silent in Nap and Night Mode), so there are no audio files.
 */
import { onBeforeUnmount, ref } from 'vue'
import { playNote } from '@/ui/sound'
import { XYLOPHONE_BARS } from './xylophone'

const STRIKE_MS = 350
/** The longest bar is the lowest note; each bar after it is a little shorter. */
const LONGEST_PCT = 100
const SHORTEST_PCT = 58

const struck = ref<string | null>(null)
let strikeTimer: ReturnType<typeof setTimeout> | undefined
/** The bar under the finger during a slide, so crossing into a new bar strikes it once. */
let slidingOver: string | null = null

function heightPct(index: number): number {
  return LONGEST_PCT - ((LONGEST_PCT - SHORTEST_PCT) * index) / (XYLOPHONE_BARS.length - 1)
}

function strike(note: string): void {
  const bar = XYLOPHONE_BARS.find((b) => b.note === note)
  if (!bar) return
  playNote(bar.frequency)
  struck.value = null
  requestAnimationFrame(() => (struck.value = note))
  clearTimeout(strikeTimer)
  strikeTimer = setTimeout(() => (struck.value = null), STRIKE_MS)
}

function onPointerDown(note: string): void {
  slidingOver = note
  strike(note)
}

/** Touch pointers stay captured by the bar first pressed, so find the bar under the finger ourselves. */
function onPointerMove(e: PointerEvent): void {
  if (slidingOver === null || e.buttons === 0) return
  const note = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-note]')?.dataset.note ?? null
  if (note === null || note === slidingOver) return
  slidingOver = note
  strike(note)
}

function onPointerEnd(): void {
  slidingOver = null
}

onBeforeUnmount(() => clearTimeout(strikeTimer))
</script>

<template>
  <section data-testid="game-music" class="flex h-full items-center justify-center px-10 py-6">
    <div
      role="group"
      aria-label="Xylophone"
      class="flex h-full max-h-[560px] w-full max-w-[1000px] items-center justify-center gap-4"
      style="touch-action: none"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @pointerleave="onPointerEnd"
    >
      <button
        v-for="(bar, i) in XYLOPHONE_BARS"
        :key="bar.note"
        type="button"
        data-testid="xylophone-bar"
        :data-note="bar.note"
        :aria-label="`Note ${i + 1}`"
        class="bar flex min-w-[88px] flex-1 items-center justify-center rounded-[22px] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
        :class="struck === bar.note && 'bar--struck'"
        :style="{ height: `${heightPct(i)}%`, background: bar.color, boxShadow: `0 14px 30px ${bar.color}55` }"
        @pointerdown.prevent="onPointerDown(bar.note)"
        @keydown.enter.prevent="strike(bar.note)"
        @keydown.space.prevent="strike(bar.note)"
      >
        <span class="block size-[22px] rounded-full bg-corner-tile opacity-80" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.bar {
  touch-action: none;
  transition: filter 120ms ease-out;
}
.bar--struck {
  animation: bar-strike 350ms ease-out both;
}
@keyframes bar-strike {
  0% {
    transform: scaleY(1);
    filter: brightness(1.25);
  }
  30% {
    transform: scaleY(0.96);
  }
  100% {
    transform: scaleY(1);
    filter: brightness(1);
  }
}
</style>
