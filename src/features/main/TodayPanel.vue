<script setup lang="ts">
/**
 * Today (spec §7.2, §13): the household's calendar events for the rest of the day, each with its person's avatar and
 * color. Long lists scroll within the panel; titles clamp to two lines. Sitter Mode replaces this panel with Care Info
 * (MainScreen). Events come from `useTodayEvents` (memory only); this component only shows them.
 */
import { computed, useId } from 'vue'
import { useNow } from '@/composables/useNow'
import type { TodayEvents } from '@/data/calendarApi'
import RAvatar from '@/ui/RAvatar.vue'
import { buildTodayModel } from './todayPanelModel'

const props = defineProps<{
  events: TodayEvents | null
  failed: boolean
  timeZone: string
  leaveByBufferMin: number
  members: ReadonlyArray<{ id: string; displayName: string; color: string }>
  children: ReadonlyArray<{ id: string; name: string; color: string }>
  /** The screen's clock; without one the panel ticks every minute itself. Decided when the panel mounts. */
  now?: Date
  /** The screen's own "Updated 7 min ago" (household data behind). When shown, the calendar's stale note is left
   *  out so there is only one such line. */
  updatedNote?: string | null
}>()

const ownNow = props.now === undefined ? useNow(60_000) : null
const headingId = useId()

const model = computed(() =>
  buildTodayModel({
    events: props.events,
    failed: props.failed,
    now: props.now ?? ownNow?.value ?? new Date(),
    timeZone: props.timeZone,
    leaveByBufferMin: props.leaveByBufferMin,
    members: props.members,
    children: props.children,
  }),
)
</script>

<template>
  <section
    data-testid="today-panel"
    :aria-labelledby="headingId"
    class="flex min-h-0 flex-1 flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-[26px] py-[22px]"
  >
    <h2 :id="headingId" class="shrink-0 text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3">Today</h2>

    <ul v-if="model.rows.length" class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2" aria-label="Today’s events">
      <li v-for="row in model.rows" :key="row.key" data-testid="today-event" class="flex shrink-0 gap-3">
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
    </ul>
    <p v-else-if="model.unreachable" class="text-[18px] text-ink-2">Calendar couldn’t be reached</p>
    <p v-else-if="model.empty" class="text-[18px] text-ink-2">Nothing else today</p>

    <div class="flex-1" />
    <p v-for="line in model.reconnect" :key="line" data-testid="today-reconnect" class="shrink-0 text-[16px] font-medium text-warn-ink">
      {{ line }}
    </p>
    <p v-if="updatedNote" data-testid="today-updated" class="shrink-0 text-[16px] text-ink-3">{{ updatedNote }}</p>
    <p v-else-if="model.stale" data-testid="today-stale" class="shrink-0 text-[16px] text-ink-3">{{ model.stale }}</p>
  </section>
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
