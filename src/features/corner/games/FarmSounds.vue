<script setup lang="ts">
/**
 * Farm (Kids' Corner games, spec §7.5): eight animals; touching one (on pointer down, not release, so the sound
 * answers the finger) makes it bounce, play its recorded call and
 * then a recording of its name. Both are preloaded when the game opens so the first tap answers at once. A name
 * recording that can't be loaded falls back to speech synthesis. Silent in Nap and Night Mode.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { playClip, preloadClip } from '@/ui/sound'
import { speak } from '../speech'
import { animalClipUrl, animalNameClipUrl, FARM_ANIMALS } from './farm'
import WordCard from './WordCard.vue'

const BOUNCE_MS = 600
/** A breath between the call and the name. */
const NAME_GAP_MS = 150

const bouncing = ref<string | null>(null)
/** The name shown big above the grid while the tapped animal plays. */
const shownName = ref<string | null>(null)
let nameTimer: ReturnType<typeof setTimeout> | undefined
/** How long the big word stays after the sounds finish. */
const WORD_LINGER_MS = 1_500
let bounceTimer: ReturnType<typeof setTimeout> | undefined

/** Counts taps, so an older tap's voice line is dropped once a newer animal has been tapped. */
let tapSerial = 0

async function tap(key: string): Promise<void> {
  const animal = FARM_ANIMALS.find((a) => a.key === key)
  if (!animal) return
  const serial = ++tapSerial
  bounce(key)
  clearTimeout(nameTimer)
  shownName.value = animal.name
  await playClip(animalClipUrl(animal))
  if (serial !== tapSerial) return
  await new Promise((resolve) => setTimeout(resolve, NAME_GAP_MS))
  if (serial !== tapSerial) return
  const said = await playClip(animalNameClipUrl(animal))
  if (!said && serial === tapSerial) speak(animal.name)
  if (serial === tapSerial) nameTimer = setTimeout(() => (shownName.value = null), WORD_LINGER_MS)
}

function bounce(key: string): void {
  bouncing.value = null
  // Restart the bounce even on a repeat tap of the same animal: a frame with no animation in between.
  requestAnimationFrame(() => (bouncing.value = key))
  clearTimeout(bounceTimer)
  bounceTimer = setTimeout(() => (bouncing.value = null), BOUNCE_MS)
}

onMounted(() => {
  for (const animal of FARM_ANIMALS) {
    void preloadClip(animalClipUrl(animal))
    void preloadClip(animalNameClipUrl(animal))
  }
})
onBeforeUnmount(() => {
  clearTimeout(bounceTimer)
  clearTimeout(nameTimer)
})
</script>

<template>
  <section data-testid="game-farm" class="flex h-full flex-col items-center justify-center gap-6 px-10 py-6">
    <div class="flex h-[96px] items-center"><WordCard :word="shownName" /></div>
    <ul class="grid grid-cols-4 gap-5">
      <li v-for="animal in FARM_ANIMALS" :key="animal.key">
        <button
          type="button"
          data-testid="farm-animal"
          :aria-label="animal.name"
          class="flex size-[164px] flex-col items-center justify-center gap-1 rounded-[28px] text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :style="[
            { background: animal.tint, boxShadow: '0 12px 30px rgba(90, 70, 54, 0.12)' },
            bouncing === animal.key ? 'animation: roost-pop 600ms ease-out both' : '',
          ]"
          @pointerdown.prevent="tap(animal.key)"
          @keydown.enter.prevent="tap(animal.key)"
          @keydown.space.prevent="tap(animal.key)"
        >
          <span class="text-[84px] leading-none" aria-hidden="true">{{ animal.emoji }}</span>
          <span class="text-[24px] font-semibold leading-tight">{{ animal.name }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
