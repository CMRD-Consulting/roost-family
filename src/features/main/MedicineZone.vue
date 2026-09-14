<script setup lang="ts">
import RAvatar from '@/ui/RAvatar.vue'
import type { MedicineLineModel } from './mainScreenModel'

defineProps<{ lines: MedicineLineModel[] }>()
</script>

<template>
  <section v-if="lines.length" aria-label="Medicine" class="flex shrink-0 flex-col gap-3 rounded-[18px] border-2 border-orange bg-surface px-5 py-2.5">
    <div
      v-for="line in lines"
      :key="`${line.doseChildId}-${line.medicineName}`"
      data-testid="medicine-line"
      class="flex min-w-0 items-center gap-4"
    >
      <RAvatar :name="line.childName" :color="line.childColor" :size="40" />
      <div class="flex min-w-0 flex-col">
        <p class="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span class="text-[22px] font-medium">{{ line.childName }} · {{ line.medicineName }}</span>
          <span class="text-[18px] text-ink-2">{{ line.givenAt }}<template v-if="line.givenBy"> by {{ line.givenBy }}</template></span>
        </p>
        <p class="flex items-center gap-2 text-[26px] leading-tight">
          <svg
            v-if="line.nextAllowed"
            data-testid="dose-allowed"
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 text-green-deep"
            aria-hidden="true"
          >
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
          <span :class="line.nextAllowed ? 'text-green-deep' : 'text-ink-2'">Next after <span class="font-semibold" :class="line.nextAllowed ? 'text-green-deep' : 'text-ink'">{{ line.nextAfter }}</span></span>
        </p>
      </div>
    </div>
  </section>
</template>
