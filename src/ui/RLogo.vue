<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 200 200" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
      <path d="M30 84 L100 26 L170 84" />
      <path d="M30 84 L170 84" />
      <path d="M52 84 L52 160 L148 160 L148 84" />
      <circle cx="100" cy="114" r="15" />
      <path d="M100 129 L92 146 L108 146 Z" />
    </g>
  </svg>
</template>
