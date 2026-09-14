<script setup lang="ts">
/** This week's sticker chart (spec §7.5): Mon–Sun columns, one row per category, today highlighted. Read-only. */
import RoutineIcon from '@/ui/RoutineIcon.vue'
import type { StickerGridModel } from './cornerModel'

defineProps<{ grid: StickerGridModel }>()

/** Stars drawn per cell before the rest is summarised as "+N". */
const MAX_STARS = 5
const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z'

const cellLabel = (day: string, count: number) => `${day}: ${count} ${count === 1 ? 'sticker' : 'stickers'}`
</script>

<template>
  <section data-testid="sticker-chart" class="flex h-full flex-col justify-center px-[60px] py-8">
    <div role="table" aria-label="Sticker chart" class="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] items-center gap-3">
      <div role="row" class="contents">
        <span role="columnheader" />
        <span
          v-for="(day, i) in grid.days"
          :key="day"
          role="columnheader"
          class="rounded-[14px] py-1 text-center text-[22px] font-semibold"
          :class="i === grid.todayIndex ? 'bg-amber text-ink' : 'text-ink-2'"
        >
          {{ day }}
        </span>
      </div>

      <div v-for="row in grid.rows" :key="row.categoryId" role="row" data-testid="sticker-row" :aria-label="row.name" class="contents">
        <span role="rowheader" class="flex items-center gap-3 text-[22px] font-semibold leading-tight text-ink-2">
          <RoutineIcon :icon-key="row.iconKey" :size="40" />
          {{ row.name }}
        </span>
        <span
          v-for="(count, i) in row.counts"
          :key="i"
          role="cell"
          data-testid="sticker-cell"
          :data-today="i === grid.todayIndex || undefined"
          :aria-label="cellLabel(grid.days[i] ?? '', count)"
          class="flex h-[96px] flex-wrap content-center items-center justify-center gap-0.5 rounded-[22px] px-1"
          :class="i === grid.todayIndex ? 'bg-surface ring-4 ring-amber' : 'bg-corner-tile'"
        >
          <svg
            v-for="n in Math.min(count, MAX_STARS)"
            :key="n"
            data-testid="sticker"
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="var(--color-amber)"
            stroke="var(--color-amber-deep)"
            stroke-width="1.2"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="STAR" />
          </svg>
          <span v-if="count > MAX_STARS" class="text-[18px] font-semibold text-amber-deep" aria-hidden="true">+{{ count - MAX_STARS }}</span>
        </span>
      </div>
    </div>
  </section>
</template>
