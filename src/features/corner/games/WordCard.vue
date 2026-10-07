<script setup lang="ts">
/**
 * A big word shown while a sound plays (Kids' Corner games, spec §7.5): the animal or colour just tapped, so
 * the child sees the written word with the spoken one. Decorative text, not a control.
 */
defineProps<{ word: string | null; color?: string }>()
</script>

<template>
  <Transition name="word">
    <p
      v-if="word"
      :key="word"
      data-testid="word-card"
      role="status"
      class="pointer-events-none flex min-h-[96px] items-center justify-center rounded-full bg-corner-tile px-10 text-[64px] font-semibold leading-none text-ink"
      :style="{ boxShadow: '0 16px 40px rgba(90, 70, 54, 0.18)', color }"
    >
      {{ word }}
    </p>
  </Transition>
</template>

<style scoped>
.word-enter-active {
  animation: roost-pop 400ms ease-out both;
}
.word-leave-active {
  transition: opacity 250ms ease-in;
}
.word-leave-to {
  opacity: 0;
}
</style>
