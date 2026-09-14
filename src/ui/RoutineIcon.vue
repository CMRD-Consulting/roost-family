<script setup lang="ts">
import { computed } from 'vue'

/** Placeholder line icons for routine steps (48-unit grid, from the v2 design's icon library). */
const PATHS: Record<string, string> = {
  breakfast: 'M8 24h32c0 9-7 14-16 14S8 33 8 24z M18 12c-2 3 2 4 0 7 M26 12c-2 3 2 4 0 7 M6 24h36',
  teeth: 'M16 8c-6 0-8 6-8 12 0 8 4 12 6 18 1 3 4 3 5 0l2-8h2l2 8c1 3 4 3 5 0 2-6 6-10 6-18 0-6-2-12-8-12-3 0-4 2-6 2s-3-2-6-2z',
  'getting-dressed': 'M18 8l6 4 6-4 10 6-4 8-4-2v20H16V20l-4 2-4-8z',
  shoes: 'M6 32h36v4H6z M6 32c0-6 6-8 10-14l6 4c4 2 8 2 12 4 6 2 8 4 8 6 M22 22l-3 4 M28 24l-3 4',
  car: 'M8 30v-6l6-10h20l6 10v6z M8 24h32 M14 36a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M34 36a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 14l-2 10 M30 14l2 10',
  books: 'M8 36h32v4H8z M10 36V16h8v20 M20 36V10h8v26 M30 36l4-22 7 2-4 20',
  snack: 'M24 14c-8-4-16 2-16 12 0 8 6 16 10 16 2 0 4-2 6-2s4 2 6 2c4 0 10-8 10-16 0-10-8-16-16-12z M24 14c0-4 2-6 6-8',
  park: 'M24 40V26 M24 26c-8 0-12-4-12-10 0-4 4-8 8-8 0-4 4-6 8-4 4-2 8 0 8 4 4 0 8 4 8 8 0 6-4 10-12 10z M8 40h32',
  nap: 'M26 8a16 16 0 1 0 14 22A14 14 0 0 1 26 8z M8 12h8l-8 8h8',
  potty: 'M12 8h20v14H12z M10 22h28c0 8-4 14-10 16v4H20v-4c-6-2-10-8-10-16z M16 14h4',
  bath: 'M6 24h36v4c0 6-4 10-10 10H16C10 38 6 34 6 28z M10 24V12a4 4 0 0 1 8 0 M14 38v4 M34 38v4 M30 14a2 2 0 1 0 0 .1 M36 8a2 2 0 1 0 0 .1',
  bed: 'M6 38V22h36v16 M6 32h36 M10 22v-8h28v8 M12 14v-4h10v4 M26 14v-4h10v4',
}
PATHS.dressed = PATHS['getting-dressed']!

const props = withDefaults(defineProps<{ iconKey: string | null; size?: number }>(), { size: 48 })
const d = computed(() => (props.iconKey ? PATHS[props.iconKey] : undefined))
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-if="d" :d="d" />
    <circle v-else cx="24" cy="24" r="14" />
  </svg>
</template>
