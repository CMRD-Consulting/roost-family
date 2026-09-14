<script setup lang="ts">
import { computed } from 'vue'

/** `decorative`: the name is already visible next to the avatar (e.g. inside a named button), so hide it from assistive tech. */
const props = withDefaults(defineProps<{ name: string; color: string; size?: number; decorative?: boolean }>(), {
  size: 48,
  decorative: false,
})
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :style="{ background: color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(16, Math.round(size * 0.5))}px` }"
    :aria-label="decorative ? undefined : name"
    :role="decorative ? undefined : 'img'"
    :aria-hidden="decorative ? 'true' : undefined"
  >
    {{ initial }}
  </span>
</template>
