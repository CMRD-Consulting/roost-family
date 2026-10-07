<script setup lang="ts">
/**
 * Farm (Kids' Corner games, spec §7.5): eight animals; tapping one makes it bounce, play its recorded call and
 * then a recording of its name. Both are preloaded when the game opens so the first tap answers at once. A name
 * recording that can't be loaded falls back to speech synthesis. Silent in Nap and Night Mode.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { playClip, preloadClip } from '@/ui/sound'
import { speak } from '../speech'
import { animalClipUrl, animalNameClipUrl, FARM_ANIMALS } from './farm'

const BOUNCE_MS = 600
/** A breath between the call and the name. */
const NAME_GAP_MS = 150

const bouncing = ref<string | null>(null)
let bounceTimer: ReturnType<typeof setTimeout> | undefined

/** Counts taps, so an older tap's voice line is dropped once a newer animal has been tapped. */
let tapSerial = 0

async function tap(key: string): Promise<void> {
  const animal = FARM_ANIMALS.find((a) => a.key === key)
  if (!animal) return
  const serial = ++tapSerial
  bounce(key)
  await playClip(animalClipUrl(animal))
  if (serial !== tapSerial) return
  await new Promise((resolve) => setTimeout(resolve, NAME_GAP_MS))
  if (serial !== tapSerial) return
  const said = await playClip(animalNameClipUrl(animal))
  if (!said && serial === tapSerial) speak(animal.name)
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
onBeforeUnmount(() => clearTimeout(bounceTimer))
</script>

<template>
  <section data-testid="game-farm" class="flex h-full items-center justify-center px-10 py-6">
    <ul class="grid grid-cols-4 gap-5">
      <li v-for="animal in FARM_ANIMALS" :key="animal.key">
        <button
          type="button"
          data-testid="farm-animal"
          :aria-label="animal.name"
          class="flex size-[180px] flex-col items-center justify-center gap-1 rounded-[28px] text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :style="[
            { background: animal.tint, boxShadow: '0 12px 30px rgba(90, 70, 54, 0.12)' },
            bouncing === animal.key ? 'animation: roost-pop 600ms ease-out both' : '',
          ]"
          @click="tap(animal.key)"
        >
          <span class="text-[96px] leading-none" aria-hidden="true">{{ animal.emoji }}</span>
          <span class="text-[24px] font-semibold leading-tight">{{ animal.name }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
