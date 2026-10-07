<script setup lang="ts">
/**
 * Colors (Kids' Corner games, spec §7.5): a colour's name is heard; three big colour discs are shown; the
 * child taps the matching one. Right: the disc pops, a chime, the word appears in that colour, next round.
 * Wrong: a wobble and a low note. The name can be replayed with the big speaker button.
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { playChime, playClip, playNote, preloadClip } from '@/ui/sound'
import { speak } from '../speech'
import { colorNameClipUrl, GAME_COLORS, type GameColor } from './colors'
import { GAME_RNG } from './rng'
import { makeRound, type Round } from './rounds'
import WordCard from './WordCard.vue'

const CHOICES = 3
const CELEBRATE_MS = 2_000
const WOBBLE_MS = 500
const WRONG_NOTE_HZ = 196

const rng = inject(GAME_RNG, Math.random)
const round = ref<Round<GameColor>>(makeRound(GAME_COLORS, rng, CHOICES, null))
const phase = ref<'asking' | 'celebrating'>('asking')
const wobbling = ref<string | null>(null)
const shownName = ref<string | null>(null)
const timers = new Set<ReturnType<typeof setTimeout>>()
let serial = 0

function later(ms: number, fn: () => void): void {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

async function ask(): Promise<void> {
  const said = await playClip(colorNameClipUrl(round.value.answer))
  if (!said) speak(round.value.answer.name)
}

function nextRound(): void {
  round.value = makeRound(GAME_COLORS, rng, CHOICES, round.value.answer.key)
  phase.value = 'asking'
  shownName.value = null
  later(400, () => void ask())
}

function choose(color: GameColor): void {
  if (phase.value !== 'asking') return
  if (color.key !== round.value.answer.key) {
    wobbling.value = null
    requestAnimationFrame(() => (wobbling.value = color.key))
    later(WOBBLE_MS, () => (wobbling.value = null))
    playNote(WRONG_NOTE_HZ)
    return
  }
  const mine = ++serial
  phase.value = 'celebrating'
  shownName.value = color.name
  playChime()
  later(CELEBRATE_MS, () => {
    if (mine === serial) nextRound()
  })
}

onMounted(() => {
  for (const c of GAME_COLORS) void preloadClip(colorNameClipUrl(c))
  later(400, () => void ask())
})
onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <section data-testid="game-colors" class="flex h-full flex-col items-center justify-center gap-8 px-10 py-6">
    <div class="flex h-[96px] items-center"><WordCard :word="shownName" :color="round.answer.hex" /></div>

    <ul class="flex items-center justify-center gap-10">
      <li v-for="color in round.choices" :key="color.key">
        <button
          type="button"
          data-testid="color-choice"
          :aria-label="color.name"
          class="size-[220px] rounded-full focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :class="[
            wobbling === color.key && 'wobble',
            phase === 'celebrating' && color.key === round.answer.key && 'celebrate',
            phase === 'celebrating' && color.key !== round.answer.key && 'opacity-40',
          ]"
          :style="{ background: color.hex, boxShadow: `0 18px 44px ${color.hex}55` }"
          @pointerdown.prevent="choose(color)"
          @keydown.enter.prevent="choose(color)"
          @keydown.space.prevent="choose(color)"
        />
      </li>
    </ul>

    <button
      type="button"
      aria-label="Hear it again"
      class="flex h-[88px] w-[160px] items-center justify-center rounded-full bg-corner-tile text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
      style="box-shadow: 0 10px 24px rgba(90, 70, 54, 0.15)"
      @pointerdown.prevent="ask"
      @keydown.enter.prevent="ask"
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9z" />
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
      </svg>
    </button>
  </section>
</template>

<style scoped>
.wobble {
  animation: wobble 500ms ease-in-out both;
}
.celebrate {
  animation: roost-pop 600ms ease-out both;
}
@keyframes wobble {
  20% { transform: translateX(-10px); }
  40% { transform: translateX(10px); }
  60% { transform: translateX(-7px); }
  80% { transform: translateX(7px); }
}
</style>
