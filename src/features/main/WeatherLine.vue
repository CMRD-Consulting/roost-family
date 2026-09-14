<script setup lang="ts">
import { computed } from 'vue'
import type { HouseholdWeather, WeatherIcon } from '@/data/snapshot'

const props = defineProps<{
  /** Weather to show, already filtered for age; null renders nothing (spec §13: weather unavailable → hide). */
  weather: HouseholdWeather | null
}>()

/** Stroke icons on a 24 px grid (after Lucide, ISC licence), drawn at 44 px. */
const ICONS: Record<WeatherIcon, string[]> = {
  sun: [
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  ],
  partly: [
    'M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41',
    'M15.947 12.65a4 4 0 0 0-5.925-4.128',
    'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z',
  ],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z'],
  rain: ['M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242', 'M16 14v6M8 14v6M12 16v6'],
  snow: [
    'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242',
    'M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01',
  ],
  storm: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'M13 12l-3 5h4l-3 5'],
  fog: ['M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242', 'M16 17H7M17 21H9'],
  wind: ['M12.8 19.6A2 2 0 1 0 14 16H2', 'M17.5 8a2.5 2.5 0 1 1 2 4H2', 'M9.8 4.4A2 2 0 1 1 11 8H2'],
}

/** Icon (44) + gap (12) + the temperature at 40 px (tabular digits ~21.5 px each, plus the degree sign), so the
 *  line claims only the room its own temperature needs before the header gives up on showing it. */
const minWidth = computed(() => {
  const chars = props.weather ? String(props.weather.currentTempF).length : 2
  return `${56 + Math.ceil(chars * 21.5 + 22)}px`
})

const details = computed(() => {
  const w = props.weather
  if (!w) return ''
  const parts: string[] = []
  if (w.highF !== null) parts.push(`H ${w.highF}°`)
  if (w.lowF !== null) parts.push(`L ${w.lowF}°`)
  if (w.precipChance !== null) parts.push(`${w.precipChance}% rain`)
  return parts.join(' · ')
})

const label = computed(() => {
  const w = props.weather
  if (!w) return ''
  const now = `${w.summary ? `${w.summary}, ` : ''}${w.currentTempF} degrees.`
  const rest: string[] = []
  if (w.highF !== null) rest.push(`High ${w.highF}`)
  if (w.lowF !== null) rest.push(`low ${w.lowF}`)
  if (w.precipChance !== null) rest.push(`${w.precipChance}% chance of rain`)
  if (rest.length === 0) return now
  const sentence = rest.join(', ')
  return `${now} ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
})
</script>

<template>
  <!-- Fills the room its parent leaves it (a size container, at least wide enough for the icon and the temperature)
       and right-aligns its content; the details appear only when they fit whole. -->
  <div v-if="weather" data-testid="weather" role="img" :aria-label="label" class="weather-line flex flex-1 justify-end" :style="{ minWidth }">
    <div class="flex flex-col items-end" aria-hidden="true">
      <div class="flex items-center gap-3">
        <svg
          data-testid="weather-icon"
          :data-icon="weather.icon"
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="shrink-0"
          :class="weather.icon === 'sun' || weather.icon === 'partly' ? 'text-amber' : 'text-ink-2'"
        >
          <path v-for="d in ICONS[weather.icon]" :key="d" :d="d" />
        </svg>
        <span data-testid="weather-temp" class="text-[40px] font-medium leading-none tabular-nums">{{ weather.currentTempF }}°</span>
      </div>
      <span
        v-if="details"
        data-testid="weather-details"
        class="weather-details mt-1 whitespace-nowrap text-[18px] leading-snug text-ink-2"
      >{{ details }}</span>
    </div>
  </div>
</template>

<style scoped>
.weather-line {
  container-type: inline-size;
}
/* "H 104° · L 100° · 100% rain" is 200 px at 18 px; narrower than that, the temperature stands alone. */
.weather-details {
  display: none;
}
@container (min-width: 200px) {
  .weather-details {
    display: block;
  }
}
</style>
