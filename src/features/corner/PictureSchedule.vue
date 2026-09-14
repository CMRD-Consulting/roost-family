<script setup lang="ts">
/**
 * Picture schedule (spec §7.5): a strip of step cards with the current one enlarged, and a giant check that
 * finishes it. Tapping a card says its label. The parent saves the step; this component only celebrates
 * (a pop on the finished card and a chime, silent in Nap and Night Mode).
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { playChime } from '@/ui/sound'
import RoutineIcon from '@/ui/RoutineIcon.vue'
import type { ScheduleModel, ScheduleStep } from './cornerModel'
import { speak } from './speech'

const props = defineProps<{ model: ScheduleModel | null }>()
const emit = defineEmits<{ complete: [] }>()

const CELEBRATION_MS = 700
/** After a finished step, taps on the big check are ignored this long, so a double tap can't finish the next step too. */
const TAP_GUARD_MS = 700
/** Cards shown before and after the current step, so the strip fits a landscape tablet. */
const BEFORE = 1
const AFTER = 3

const current = computed<ScheduleStep | null>(() => {
  const m = props.model
  return m === null || m.currentIndex === null ? null : (m.steps[m.currentIndex] ?? null)
})

const visibleSteps = computed<ScheduleStep[]>(() => {
  const m = props.model
  if (m === null || m.currentIndex === null) return []
  return m.steps.slice(Math.max(0, m.currentIndex - BEFORE), m.currentIndex + AFTER + 1)
})

/** The step that was just finished, popped for a moment. */
const celebrating = ref<number | null>(null)
let celebrationTimer: ReturnType<typeof setTimeout> | undefined
/** Epoch ms before which the big check ignores taps. */
let acceptTapsAt = 0

function finishCurrent(): void {
  const step = current.value
  // The view moves to the next step at once (optimistic save): a second tap now would finish that one as well.
  if (step === null || celebrating.value !== null || Date.now() < acceptTapsAt) return
  acceptTapsAt = Date.now() + TAP_GUARD_MS
  celebrating.value = step.index
  clearTimeout(celebrationTimer)
  celebrationTimer = setTimeout(() => (celebrating.value = null), CELEBRATION_MS)
  playChime()
  emit('complete')
}

onBeforeUnmount(() => clearTimeout(celebrationTimer))
</script>

<template>
  <section data-testid="picture-schedule" class="flex h-full flex-col items-center justify-center gap-9 px-10">
    <div v-if="model === null" data-testid="no-routine" class="flex flex-col items-center gap-6 text-ink-2">
      <span class="flex size-[200px] items-center justify-center rounded-[40px] bg-corner-tile">
        <RoutineIcon icon-key="park" :size="120" />
      </span>
      <p class="text-[32px] font-semibold">No schedule today</p>
    </div>

    <div
      v-else-if="current === null"
      data-testid="all-done"
      role="status"
      class="flex flex-col items-center gap-6 text-ink-2"
    >
      <span
        class="flex size-[240px] items-center justify-center rounded-full bg-amber"
        style="animation: roost-pop 600ms ease-out both; box-shadow: 0 20px 60px rgba(217, 164, 65, 0.45)"
      >
        <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="#FBF6EE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
        </svg>
      </span>
      <p class="text-[36px] font-semibold">All done!</p>
    </div>

    <template v-else>
      <ol class="flex items-end justify-center gap-5">
        <li v-for="step in visibleSteps" :key="step.index">
          <button
            type="button"
            data-testid="step-card"
            :aria-label="step.label"
            :aria-current="step.index === current.index ? 'step' : undefined"
            class="flex flex-col items-center gap-3 rounded-[28px] text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
            :class="step.done && 'opacity-55'"
            @click="speak(step.label)"
          >
            <span
              class="relative flex items-center justify-center rounded-[28px] bg-corner-tile"
              :class="step.index === current.index ? 'size-[240px]' : 'size-[140px]'"
              :style="[
                step.index === current.index ? 'box-shadow: 0 20px 50px rgba(90, 70, 54, 0.22)' : '',
                step.index === celebrating ? 'animation: roost-pop 600ms ease-out both' : '',
              ]"
            >
              <RoutineIcon :icon-key="step.iconKey" :size="step.index === current.index ? 120 : 64" />
              <span
                v-if="step.done"
                data-testid="step-done"
                class="absolute -right-2 -top-2 flex size-[44px] items-center justify-center rounded-full bg-green text-surface"
                aria-hidden="true"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </span>
            </span>
            <span class="font-semibold" :class="step.index === current.index ? 'text-[32px]' : 'text-[22px]'">{{ step.label }}</span>
          </button>
        </li>
      </ol>

      <button
        type="button"
        :aria-label="`Done with ${current.label}`"
        class="flex size-[160px] shrink-0 items-center justify-center rounded-full bg-green text-surface focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
        style="box-shadow: 0 16px 40px rgba(95, 168, 140, 0.45)"
        @click="finishCurrent"
      >
        <svg width="90" height="90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      </button>
    </template>
  </section>
</template>
