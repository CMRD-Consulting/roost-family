<script setup lang="ts">
import RLongPress from '@/ui/RLongPress.vue'
import type { LogKind } from './mainScreenModel'

defineProps<{ buttons: LogKind[] }>()
const emit = defineEmits<{ open: [kind: LogKind] }>()

/** Bright fills carry ink text and icons (≥ 4.9:1); the deep variants don't contrast on the bright fills. */
const LOOK: Record<LogKind, { label: string; bg: string; icon: string }> = {
  sleep: { label: 'Sleep', bg: 'bg-surface-2', icon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z' },
  feeding: { label: 'Feeding', bg: 'bg-green', icon: 'M9 3h6 M10 3v3l-2 3v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9l-2-3V3 M8 13h8' },
  medicine: { label: 'Medicine', bg: 'bg-orange', icon: 'M12 5v14 M5 12h14' },
  sticker: { label: 'Sticker', bg: 'bg-amber', icon: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z' },
  jot: { label: 'Jot it', bg: 'bg-surface-2', icon: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4' },
  grocery: { label: 'Grocery', bg: 'bg-surface-2', icon: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01' },
  diaper: { label: 'Diaper', bg: 'bg-surface-2', icon: 'M12 3c3 4.5 6 8 6 11.5a6 6 0 0 1-12 0C6 11 9 7.5 12 3z' },
}
</script>

<template>
  <nav aria-label="Log" class="grid min-w-0 gap-[14px]" :style="{ gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))` }">
    <RLongPress
      v-for="kind in buttons"
      :key="kind"
      :data-log-kind="kind"
      class="flex h-[96px] min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-button)] px-2 text-[20px] font-semibold whitespace-nowrap text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
      :class="LOOK[kind].bg"
      @complete="emit('open', kind)"
    >
      <span class="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <span class="r-longpress-ring absolute -inset-1.5" aria-hidden="true" />
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path :d="LOOK[kind].icon" />
        </svg>
      </span>
      <span>{{ LOOK[kind].label }}</span>
    </RLongPress>
  </nav>
</template>
