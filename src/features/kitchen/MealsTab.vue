<script setup lang="ts">
/**
 * Meals tab (kitchen spec §5.4): seven day cards for the household week — today first and marked, then the
 * next six — each showing the weekday, the date and the planned dinner or "Not planned". Tapping a day opens
 * the sheet that sets or clears it. The week is read from the tablet's own clock, so it rolls over at
 * household midnight on its own. No PIN (§2); the commands queue offline like every other log command.
 */
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import type { LogCommand } from '@/data/logCommands'
import { householdDate } from '@/domain/time'
import SheetError from '@/features/logs/SheetError.vue'
import { useLogSheet } from '@/features/logs/useLogSheet'
import PlanDaySheet from './PlanDaySheet.vue'
import { NOT_PLANNED, buildMealsModel } from './mealsModel'

/** The Kitchen screen holds Night Mode off while this tab's sheet is open (design §7.7). */
const emit = defineEmits<{ 'sheet-open': [open: boolean] }>()

const { view, error, submit } = useLogSheet()
// Only the household's own date depends on the clock, and it changes once a day.
const now = useNow(60_000)

/** The day whose sheet is open, or null. */
const planning = ref<string | null>(null)

const today = computed(() => householdDate(now.value, view.value?.household.timeZone ?? 'UTC'))
const cards = computed(() => buildMealsModel(view.value?.mealPlan, view.value?.recipes, today.value))
const sheetDays = computed(() => cards.value.filter((card) => card.day === planning.value))

const sheetOpen = computed(() => planning.value !== null)
watch(sheetOpen, (open) => emit('sheet-open', open), { immediate: true })

async function plan(cmd: LogCommand): Promise<void> {
  planning.value = null
  await submit(cmd)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <SheetError :message="error" />

    <ul class="flex flex-col gap-3" aria-label="This week's dinners">
      <li v-for="card in cards" :key="card.day">
        <button
          type="button"
          data-testid="meal-day"
          class="flex min-h-[84px] w-full items-center gap-6 rounded-[var(--radius-card)] px-6 py-4 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
          :class="card.isToday ? 'bg-surface ring-3 ring-orange-deep' : 'bg-surface'"
          :aria-label="`${card.weekdayLabel} ${card.dateLabel}: ${card.planned?.text ?? NOT_PLANNED}`"
          @click="planning = card.day"
        >
          <span class="flex w-[190px] shrink-0 flex-col">
            <!-- Today is named, never marked by colour alone (design §4). -->
            <span class="text-[24px] font-semibold text-ink">{{ card.weekdayLabel }}</span>
            <span class="text-[18px] text-ink-2">{{ card.dateLabel }}</span>
          </span>
          <span v-if="card.planned" class="text-[24px] text-ink">{{ card.planned.text }}</span>
          <span v-else class="text-[24px] text-ink-3">{{ NOT_PLANNED }}</span>
        </button>
      </li>
    </ul>

    <PlanDaySheet
      v-if="view"
      :open="planning !== null"
      :household-id="view.household.id"
      :days="sheetDays"
      :recipes="view.recipes ?? []"
      @close="planning = null"
      @submit="plan"
    />
  </div>
</template>
