<script setup lang="ts">
/** Stands in for a Settings section that isn't available yet. */
defineProps<{ title: string }>()
</script>

<template>
  <section aria-labelledby="settings-coming-soon-title" class="flex flex-col gap-5">
    <h2 id="settings-coming-soon-title" class="text-[32px] font-semibold text-ink">{{ title }}</h2>
    <div class="rounded-[var(--radius-card)] bg-surface px-6 py-8">
      <p class="text-[22px] font-medium text-ink">Coming soon</p>
      <p class="mt-2 text-[18px] text-ink-3">This part of Settings will be ready in an upcoming update.</p>
    </div>
  </section>
</template>
