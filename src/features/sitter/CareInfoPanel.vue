<script setup lang="ts">
/** Care Info (spec §7.6): replaces the calendar and dinner panels while Sitter Mode is on. Scrolls within its panel. */
import { useId } from 'vue'
import type { CareInfoModel } from './sitterModel'

defineProps<{ model: CareInfoModel }>()
const headingId = useId()
</script>

<template>
  <section
    data-testid="care-info"
    :aria-labelledby="headingId"
    class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] bg-surface px-[26px] py-[22px]"
  >
    <h2 :id="headingId" class="text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Care info</h2>
    <div v-for="section in model.sections" :key="section.title" data-testid="care-info-section" class="flex flex-col gap-1">
      <h3 class="text-[18px] font-semibold text-ink-2">{{ section.title }}</h3>
      <p class="whitespace-pre-line text-[20px] leading-snug text-ink">{{ section.body }}</p>
    </div>
    <p v-if="model.sections.length === 0" class="text-[18px] text-ink-3">No care notes yet. Adults can add them in Settings.</p>
  </section>
</template>
