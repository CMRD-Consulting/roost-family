<script setup lang="ts">
/**
 * Today (spec §7.2, §13): the household's calendar events for the rest of the day, each with its person's avatar and
 * color, and under them — in whatever room today leaves — tomorrow's. Long lists scroll within the panel; titles
 * clamp to two lines. Sitter Mode replaces this panel with Care Info
 * (MainScreen). Events come from `useTodayEvents` (memory only); this component only shows them.
 */
import { computed, useId } from 'vue'
import { useNow } from '@/composables/useNow'
import type { TodayEvents } from '@/data/calendarApi'
import TodayEventRow from './TodayEventRow.vue'
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

    <div class="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2">
      <ul v-if="model.rows.length" class="flex shrink-0 flex-col gap-4" aria-label="Today’s events">
        <TodayEventRow v-for="row in model.rows" :key="row.key" :row="row" data-testid="today-event" />
      </ul>
      <p v-else-if="model.unreachable" class="shrink-0 text-[18px] text-ink-2">Calendar couldn’t be reached</p>
      <p v-else-if="model.empty" class="shrink-0 text-[18px] text-ink-2">Nothing else today</p>

      <template v-if="model.tomorrow">
        <h3
          data-testid="tomorrow-heading"
          class="shrink-0 border-t border-line pt-3 text-[16px] font-semibold uppercase tracking-[0.1em] text-ink-3"
        >{{ model.tomorrow.label }}</h3>
        <ul class="flex shrink-0 flex-col gap-4" aria-label="Tomorrow’s events">
          <TodayEventRow v-for="row in model.tomorrow.rows" :key="row.key" :row="row" data-testid="tomorrow-event" />
        </ul>
        <p v-if="model.tomorrow.more" data-testid="tomorrow-more" class="shrink-0 text-[16px] text-ink-3">
          +{{ model.tomorrow.more }} more tomorrow
        </p>
      </template>
    </div>

    <div class="flex-1" />
    <p v-for="line in model.reconnect" :key="line" data-testid="today-reconnect" class="shrink-0 text-[16px] font-medium text-warn-ink">
      {{ line }}
    </p>
    <p v-if="updatedNote" data-testid="today-updated" class="shrink-0 text-[16px] text-ink-3">{{ updatedNote }}</p>
    <p v-else-if="model.stale" data-testid="today-stale" class="shrink-0 text-[16px] text-ink-3">{{ model.stale }}</p>
  </section>
</template>

