<script setup lang="ts">
import type { ConflictModel } from './mainScreenModel'

defineProps<{ conflicts: ConflictModel[] }>()
const emit = defineEmits<{ acknowledge: [doseId: string] }>()
</script>

<template>
  <section v-if="conflicts.length" role="alert" class="flex shrink-0 flex-col gap-3 rounded-[18px] bg-orange-tint px-5 py-3 text-warn-ink">
    <div v-for="c in conflicts" :key="c.doseId" data-testid="conflict" class="flex items-center gap-4">
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="shrink-0"
        aria-hidden="true"
      >
        <path d="M12 3l10 18H2z" />
        <path d="M12 10v4M12 17.5v.5" />
      </svg>
      <p class="min-w-0 flex-1 text-[22px] leading-snug"><strong class="font-semibold">Dose alert.</strong> {{ c.message }}</p>
      <button
        type="button"
        class="h-[60px] shrink-0 whitespace-nowrap rounded-[var(--radius-control)] bg-surface px-5 text-[18px] font-semibold text-warn-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-warn-ink"
        @click="emit('acknowledge', c.doseId)"
      >
        Acknowledge
      </button>
    </div>
  </section>
</template>
