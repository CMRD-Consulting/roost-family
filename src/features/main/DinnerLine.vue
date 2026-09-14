<script setup lang="ts">
defineProps<{ dinner: string | null }>()
</script>

<template>
  <section class="flex min-w-0 shrink-0 items-baseline gap-4 rounded-[var(--radius-card)] bg-surface px-[26px] py-3">
    <h2 class="shrink-0 text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Tonight</h2>
    <span v-if="dinner" class="truncate text-[30px] font-medium">{{ dinner }}</span>
    <span v-else class="text-[24px] text-ink-3">Not planned</span>
  </section>
</template>
