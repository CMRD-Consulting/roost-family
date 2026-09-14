<script setup lang="ts">
import RLongPress from '@/ui/RLongPress.vue'

defineProps<{ dinner: string | null }>()
const emit = defineEmits<{ edit: [] }>()
</script>

<template>
  <!-- Long-press to edit tonight's dinner (spec §7.2). -->
  <RLongPress
    data-testid="dinner-line"
    class="flex min-h-[60px] min-w-0 shrink-0 items-baseline gap-4 rounded-[var(--radius-card)] bg-surface px-[26px] py-3 text-left text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
    @complete="emit('edit')"
  >
    <span class="shrink-0 text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Tonight</span>
    <span v-if="dinner" class="truncate text-[30px] font-medium">{{ dinner }}</span>
    <span v-else class="text-[24px] text-ink-3">Not planned</span>
    <span class="sr-only">Hold to edit</span>
    <!-- Fill ring while held; positioned out of flow so it doesn't take room from the dinner text. -->
    <span class="r-longpress-ring absolute right-3 top-1/2 h-7 w-7 -translate-y-1/2 text-ink-2" aria-hidden="true" />
  </RLongPress>
</template>
