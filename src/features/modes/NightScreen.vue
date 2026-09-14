<script setup lang="ts">
/**
 * Full-screen Night Mode (spec §7.7): the household's slideshow photos, one a minute under a dark scrim, with a small
 * clock in the corner; with no photos (or none loaded), a dim clock alone over a slow radial gradient. Tapping
 * anywhere calls `peek()` (via the parent's `modes.peek()`), which shows the dimmed main screen for 60 s.
 */
import { computed, ref } from 'vue'
import type { HouseholdPhoto } from '@/data/snapshot'
import NightSlideshow from './NightSlideshow.vue'
import { NIGHT_CLOCK_ALPHA, NIGHT_DATE_ALPHA, NIGHT_GRADIENT, NIGHT_PHOTO_TEXT_ALPHA, nightText } from './nightColors'

const props = withDefaults(defineProps<{ clock: string; date: string; photos?: HouseholdPhoto[]; timeZone?: string }>(), {
  photos: () => [],
  timeZone: 'UTC',
})
const emit = defineEmits<{ peek: [] }>()

const slideshowPhotos = computed(() => props.photos.filter((p) => p.kind === 'slideshow'))
const showingPhoto = ref(false)
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
    <NightSlideshow
      v-if="slideshowPhotos.length > 0"
      :photos="slideshowPhotos"
      :time-zone="timeZone"
      @showing="showingPhoto = $event"
    />
    <!-- Over a photo the text moves to the corner and brightens to keep 3:1 through the scrim; alone it stays dim,
         but at least 3:1 against the gradient (see nightColors.ts). -->
    <div
      data-testid="night-text"
      class="relative z-10 flex h-full flex-col gap-3"
      :class="showingPhoto ? 'items-end justify-end px-11 pb-9' : 'items-center justify-center'"
    >
      <p
        class="text-[64px] font-medium leading-none tabular-nums"
        :style="{ color: nightText(showingPhoto ? NIGHT_PHOTO_TEXT_ALPHA : NIGHT_CLOCK_ALPHA) }"
      >
        {{ clock }}
      </p>
      <p
        data-testid="night-date"
        class="text-[18px]"
        :style="{ color: nightText(showingPhoto ? NIGHT_PHOTO_TEXT_ALPHA : NIGHT_DATE_ALPHA) }"
      >
        {{ date }}
      </p>
    </div>
  </div>
</template>
