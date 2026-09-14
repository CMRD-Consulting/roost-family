<script setup lang="ts">
import RAvatar from '@/ui/RAvatar.vue'
import RoutineIcon from '@/ui/RoutineIcon.vue'
import type { KidCardModel } from './mainScreenModel'

defineProps<{ card: KidCardModel }>()
</script>

<template>
  <article
    data-testid="kid-card"
    class="flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border-t-8 bg-surface px-[22px] pb-[18px] pt-4"
    :style="{ borderTopColor: card.color }"
  >
    <header class="flex min-w-0 items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <RAvatar :name="card.name" :color="card.color" :size="56" />
        <span class="truncate text-[24px] font-medium leading-tight">{{ card.name }}</span>
      </div>
      <span class="shrink-0 text-[18px] text-ink-3">{{ card.ageLabel }}</span>
    </header>

    <div v-if="card.sleep" class="flex min-w-0 flex-col">
      <span
        class="truncate text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] min-[1300px]:text-[46px]"
        :class="card.sleep.kind === 'stale' ? 'text-orange-deep' : card.sleep.kind === 'unknown' ? 'text-ink-2' : 'text-ink'"
      >
        {{ card.sleep.label }}
      </span>
      <span v-if="card.sleep.kind === 'stale'" class="text-[16px] text-ink-3">tap to fix</span>
    </div>

    <p v-if="card.feeding" class="truncate text-[20px] text-ink-2">{{ card.feeding }}</p>

    <div v-if="card.nowNext && (card.nowNext.now || card.nowNext.next)" class="mt-1 flex min-w-0 items-stretch gap-2">
      <div v-if="card.nowNext.now" class="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
        <RoutineIcon :icon-key="card.nowNext.now.iconKey" :size="40" class="text-ink-2 max-[1099px]:hidden" />
        <div class="flex min-w-0 flex-col">
          <span class="text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-3">Now</span>
          <span class="text-[22px] font-semibold leading-tight break-words hyphens-auto">{{ card.nowNext.now.label }}</span>
        </div>
      </div>
      <div v-if="card.nowNext.next" class="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border-2 border-surface-2 px-3 py-2">
        <RoutineIcon :icon-key="card.nowNext.next.iconKey" :size="40" class="text-ink-3 max-[1099px]:hidden" />
        <div class="flex min-w-0 flex-col">
          <span class="text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-3">Next</span>
          <span class="text-[22px] font-medium leading-tight text-ink-2 break-words hyphens-auto">{{ card.nowNext.next.label }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
