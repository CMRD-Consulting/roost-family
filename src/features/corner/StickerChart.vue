<script setup lang="ts">
/** This week's sticker chart (spec §7.5): Mon–Sun columns, one row per category, today highlighted. Read-only. */
import RoutineIcon from '@/ui/RoutineIcon.vue'
import type { StickerGridModel } from './cornerModel'

defineProps<{ grid: StickerGridModel }>()

/** Stars drawn per cell before the rest is summarised as "+N". */
const MAX_STARS = 5
const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z'

const countLabel = (count: number) => `${count} ${count === 1 ? 'sticker' : 'stickers'}`
</script>

<template>
  <section data-testid="sticker-chart" class="flex h-full flex-col justify-center px-[60px] py-8">
    <!-- A native table (screen readers announce the day and category for each cell), laid out like the grid it
         replaced: a 200 px label column, seven equal day columns and 12 px gaps (the negative margin cancels the spacing
         border-spacing also puts around the outside). -->
    <table class="-m-3 w-[calc(100%+1.5rem)] table-fixed border-separate border-spacing-3">
      <caption class="sr-only">Sticker chart</caption>
      <colgroup>
        <col class="w-[200px]" />
        <col v-for="day in grid.days" :key="day" />
      </colgroup>
      <thead>
        <tr>
          <td />
          <th
            v-for="(day, i) in grid.days"
            :key="day"
            scope="col"
            class="rounded-[14px] py-1 text-center text-[22px] font-semibold"
            :class="i === grid.todayIndex ? 'bg-amber text-ink' : 'text-ink-2'"
          >
            {{ day }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in grid.rows" :key="row.categoryId" data-testid="sticker-row">
          <th scope="row" class="p-0 text-left align-middle text-[22px] font-semibold leading-tight text-ink-2">
            <span class="flex items-center gap-3">
              <RoutineIcon :icon-key="row.iconKey" :size="40" />
              <span>{{ row.name }}</span>
            </span>
          </th>
          <td
            v-for="(count, i) in row.counts"
            :key="i"
            data-testid="sticker-cell"
            :data-today="i === grid.todayIndex || undefined"
            class="h-[96px] rounded-[22px] p-0 align-middle"
            :class="i === grid.todayIndex ? 'bg-surface ring-4 ring-amber' : 'bg-corner-tile'"
          >
            <span class="flex h-full flex-wrap content-center items-center justify-center gap-0.5 px-1">
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
              <span class="sr-only">{{ countLabel(count) }}</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
