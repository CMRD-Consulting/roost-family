<script setup lang="ts">
import RAvatar from '@/ui/RAvatar.vue'
import RoutineIcon from '@/ui/RoutineIcon.vue'
import type { KidCardModel } from './mainScreenModel'

defineProps<{ card: KidCardModel }>()
const emit = defineEmits<{ fixSleep: [childId: string] }>()
</script>

<template>
  <article
    data-testid="kid-card"
    class="flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border-t-8 bg-surface px-[22px] pb-[18px] pt-4"
    :style="{ borderTopColor: card.color }"
  >
    <header class="flex min-w-0 items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <RAvatar :name="card.name" :color="card.color" :size="56" decorative />
        <span class="truncate text-[24px] font-medium leading-tight">{{ card.name }}</span>
      </div>
      <span class="shrink-0 text-[18px] text-ink-3">{{ card.ageLabel }}</span>
    </header>

    <!-- A forgotten open sleep (spec §7.4): the whole status area opens "Still sleeping?". -->
    <button
      v-if="card.sleep?.kind === 'stale'"
      type="button"
      data-testid="fix-sleep"
      class="-mx-2 flex min-h-[60px] min-w-0 flex-col items-start rounded-[var(--radius-control)] px-2 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
      @click="emit('fixSleep', card.childId)"
    >
      <span class="max-w-full truncate text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-orange-deep pb-[0.15em] -mb-[0.15em] min-[1300px]:text-[46px]">
        {{ card.sleep.label }}
      </span>
      <span class="text-[16px] text-ink-3">tap to fix</span>
    </button>
    <div v-else-if="card.sleep" class="flex min-w-0 flex-col">
      <span
        class="truncate text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] pb-[0.15em] -mb-[0.15em] min-[1300px]:text-[46px]"
        :class="card.sleep.kind === 'unknown' ? 'text-ink-2' : 'text-ink'"
      >
        {{ card.sleep.label }}
      </span>
    </div>

    <p v-if="card.feeding" class="truncate text-[20px] text-ink-2">{{ card.feeding }}</p>

    <div v-if="card.nowNext && (card.nowNext.now || card.nowNext.next)" class="mt-1 flex min-w-0 items-stretch gap-2">
      <div v-if="card.nowNext.now" class="flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
        <div class="flex items-center gap-2">
          <RoutineIcon :icon-key="card.nowNext.now.iconKey" :size="28" class="shrink-0 text-ink-2" />
          <span class="text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-3">Now</span>
        </div>
        <span class="text-[22px] font-semibold leading-tight [overflow-wrap:normal] [hyphens:none]">{{ card.nowNext.now.label }}</span>
      </div>
      <div v-if="card.nowNext.next" class="flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-control)] border-2 border-surface-2 px-3 py-2">
        <div class="flex items-center gap-2">
          <RoutineIcon :icon-key="card.nowNext.next.iconKey" :size="28" class="shrink-0 text-ink-3" />
          <span class="text-[16px] font-semibold uppercase tracking-[0.08em] text-ink-3">Next</span>
        </div>
        <span class="text-[22px] font-medium leading-tight text-ink-2 [overflow-wrap:normal] [hyphens:none]">{{ card.nowNext.next.label }}</span>
      </div>
    </div>
  </article>
</template>
