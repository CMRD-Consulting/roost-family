<script setup lang="ts">
/**
 * One row of the Today panel: the calendar's color bar, the time (or "Now"), the title, a location and a leave-by.
 * Used for today's events and tomorrow's alike; the panel supplies the list semantics and the test id.
 */
import RAvatar from '@/ui/RAvatar.vue'
import type { TodayRow } from './todayPanelModel'

defineProps<{ row: TodayRow }>()
</script>

<template>
  <li class="flex shrink-0 gap-3">
    <span class="w-1.5 shrink-0 self-stretch rounded-full" :style="{ background: row.barColor }" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        <RAvatar v-if="row.person" :name="row.person.name" :color="row.person.color" :size="28" decorative />
        <span
          data-testid="today-event-time"
          class="min-w-0 truncate text-[18px] tabular-nums"
          :class="row.now ? 'font-semibold text-green-deep' : 'text-ink-2'"
        >{{ row.time }}</span>
      </div>
      <p data-testid="today-event-title" class="today-title text-[24px] font-medium leading-tight break-words text-ink">{{ row.title }}</p>
      <p v-if="row.location" class="truncate text-[18px] text-ink-3">{{ row.location }}</p>
      <p v-if="row.leave" data-testid="today-event-leave" class="text-[24px] font-semibold text-orange-deep">{{ row.leave }}</p>
    </div>
  </li>
</template>

<style scoped>
.today-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
</style>
