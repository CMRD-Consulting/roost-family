<script setup lang="ts">
/**
 * Memory (Kids' Corner games, spec §7.5): twelve face-down cards, six pairs of animals. Turn two over; a pair
 * stays up and the animal calls (its name shown big); a miss turns back after a moment. When every pair is
 * found, a celebration, then a fresh deal.
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { playChime, playClip, preloadClip } from '@/ui/sound'
import { animalClipUrl, FARM_ANIMALS } from './farm'
import { deal, flip, hideMisses, isComplete, type MemoryState } from './memory'
import { GAME_RNG } from './rng'
import WordCard from './WordCard.vue'

const MISS_SHOW_MS = 900
const WORD_LINGER_MS = 1_500
const REDEAL_MS = 3_000

const rng = inject(GAME_RNG, Math.random)
const state = ref<MemoryState>(deal(FARM_ANIMALS, rng))
const complete = ref(false)
const shownName = ref<string | null>(null)
const timers = new Set<ReturnType<typeof setTimeout>>()

function later(ms: number, fn: () => void): void {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

function turn(id: number): void {
  if (complete.value) return
  const { state: next, result } = flip(state.value, id)
  state.value = next
  if (result === 'miss') {
    later(MISS_SHOW_MS, () => (state.value = hideMisses(state.value)))
  } else if (result === 'match') {
    const animal = next.cards.find((c) => c.id === id)!.animal
    shownName.value = animal.name
    void playClip(animalClipUrl(animal))
    later(WORD_LINGER_MS, () => {
      if (shownName.value === animal.name) shownName.value = null
    })
    if (isComplete(next)) {
      complete.value = true
      later(600, playChime)
      later(REDEAL_MS, () => {
        state.value = deal(FARM_ANIMALS, rng)
        complete.value = false
        shownName.value = null
      })
    }
  }
}

onMounted(() => {
  for (const a of FARM_ANIMALS) void preloadClip(animalClipUrl(a))
})
onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <section data-testid="game-memory" class="flex h-full flex-col items-center justify-center gap-5 px-10 py-4">
    <div class="flex h-[96px] items-center">
      <span
        v-if="complete"
        data-testid="memory-complete"
        role="status"
        class="flex size-[96px] items-center justify-center rounded-full bg-amber"
        style="animation: roost-pop 600ms ease-out both; box-shadow: 0 16px 40px rgba(217, 164, 65, 0.45)"
      >
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#FBF6EE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
        </svg>
      </span>
      <WordCard v-else :word="shownName" />
    </div>

    <ul class="grid grid-cols-4 gap-4">
      <li v-for="card in state.cards" :key="card.id">
        <button
          type="button"
          data-testid="memory-card"
          :aria-label="card.faceUp || card.matched ? card.animal.name : 'Card'"
          :aria-pressed="card.faceUp || card.matched"
          class="card relative size-[136px] rounded-[24px] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :class="(card.faceUp || card.matched) && 'card--up'"
          :disabled="card.matched"
          @pointerdown.prevent="turn(card.id)"
          @keydown.enter.prevent="turn(card.id)"
          @keydown.space.prevent="turn(card.id)"
        >
          <span class="card-face card-back flex items-center justify-center rounded-[24px] bg-corner-bar text-ink-2" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor" class="opacity-50">
              <circle cx="8" cy="7" r="2.2" /><circle cx="13.5" cy="5.5" r="2.2" /><circle cx="18" cy="9" r="2" /><circle cx="4.5" cy="11.5" r="1.8" />
              <path d="M12 10c3.5 0 6.5 3 6.5 6s-2.5 4.5-6.5 4.5S5.5 19 5.5 16s3-6 6.5-6z" />
            </svg>
          </span>
          <span
            class="card-face card-front flex items-center justify-center rounded-[24px]"
            :class="card.matched && 'opacity-70'"
            :style="{ background: card.animal.tint }"
            aria-hidden="true"
          >
            <span class="text-[84px] leading-none">{{ card.animal.emoji }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.card {
  perspective: 800px;
  touch-action: none;
}
.card-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  transition: transform 350ms ease;
  box-shadow: 0 10px 24px rgba(90, 70, 54, 0.14);
}
.card-front {
  transform: rotateY(180deg);
}
.card--up .card-back {
  transform: rotateY(180deg);
}
.card--up .card-front {
  transform: rotateY(0deg);
}
</style>
