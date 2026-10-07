<script setup lang="ts">
/**
 * Who Said That? (Kids' Corner games, spec §7.5): an animal's call plays; three animals are shown; the child
 * taps the one that made it. Right: the tile pops, a chime, the name is heard and shown, then a new round.
 * Wrong: a gentle wobble and a low note, nothing else; the call can be replayed with the big speaker button.
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { playChime, playClip, playNote, preloadClip } from '@/ui/sound'
import { speak } from '../speech'
import { animalClipUrl, animalNameClipUrl, FARM_ANIMALS, type FarmAnimal } from './farm'
import { GAME_RNG } from './rng'
import { makeRound, type Round } from './rounds'
import WordCard from './WordCard.vue'

const CHOICES = 3
/** How long the right answer celebrates before the next round. */
const CELEBRATE_MS = 2_200
const WOBBLE_MS = 500
const WRONG_NOTE_HZ = 196

const rng = inject(GAME_RNG, Math.random)
const round = ref<Round<FarmAnimal>>(makeRound(FARM_ANIMALS, rng, CHOICES, null))
/** 'asking' while the child chooses; 'celebrating' after the right answer until the next round. */
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

function ask(): void {
  void playClip(animalClipUrl(round.value.answer))
}

function nextRound(): void {
  round.value = makeRound(FARM_ANIMALS, rng, CHOICES, round.value.answer.key)
  phase.value = 'asking'
  shownName.value = null
  later(400, ask)
}

async function choose(animal: FarmAnimal): Promise<void> {
  if (phase.value !== 'asking') return
  if (animal.key !== round.value.answer.key) {
    wobbling.value = null
    requestAnimationFrame(() => (wobbling.value = animal.key))
    later(WOBBLE_MS, () => (wobbling.value = null))
    playNote(WRONG_NOTE_HZ)
    return
  }
  const mine = ++serial
  phase.value = 'celebrating'
  shownName.value = animal.name
  playChime()
  later(CELEBRATE_MS, () => {
    if (mine === serial) nextRound()
  })
  const said = await playClip(animalNameClipUrl(animal))
  if (!said && mine === serial) speak(animal.name)
}

onMounted(() => {
  for (const a of FARM_ANIMALS) {
    void preloadClip(animalClipUrl(a))
    void preloadClip(animalNameClipUrl(a))
  }
  later(400, ask)
})
onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <section data-testid="game-who" class="flex h-full flex-col items-center justify-center gap-8 px-10 py-6">
    <div class="flex h-[96px] items-center"><WordCard :word="shownName" /></div>

    <ul class="flex items-center justify-center gap-8">
      <li v-for="animal in round.choices" :key="animal.key">
        <button
          type="button"
          data-testid="who-choice"
          :aria-label="animal.name"
          class="flex size-[220px] items-center justify-center rounded-[32px] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :class="[
            wobbling === animal.key && 'wobble',
            phase === 'celebrating' && animal.key === round.answer.key && 'celebrate',
            phase === 'celebrating' && animal.key !== round.answer.key && 'opacity-40',
          ]"
          :style="{ background: animal.tint, boxShadow: '0 16px 40px rgba(90, 70, 54, 0.14)' }"
          @pointerdown.prevent="choose(animal)"
          @keydown.enter.prevent="choose(animal)"
          @keydown.space.prevent="choose(animal)"
        >
          <span class="text-[130px] leading-none" aria-hidden="true">{{ animal.emoji }}</span>
        </button>
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
  20% { transform: translateX(-10px) rotate(-3deg); }
  40% { transform: translateX(10px) rotate(3deg); }
  60% { transform: translateX(-7px) rotate(-2deg); }
  80% { transform: translateX(7px) rotate(2deg); }
}
</style>
