<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; color: string; size?: number }>(), { size: 48 })
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :style="{ background: color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(16, Math.round(size * 0.5))}px` }"
    :aria-label="name"
    role="img"
  >
    {{ initial }}
  </span>
</template>
