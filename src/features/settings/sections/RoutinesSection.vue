<script setup lang="ts">
/**
 * Settings > Routines (spec §7.5, §7.9): per child, the routines with their default weekdays, the editor, and
 * "Switch today's routine" (a day override for today's household date, or back to the weekday default).
 */
import { computed, ref, useId, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { routineForDay } from '@/domain/routines'
import { householdDate, householdWeekday } from '@/domain/time'
import type { Routine } from '@/domain/types'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import { todaysRoutineChoice, weekdaySummary } from '../routineForm'
import { useSettingsSave } from '../useSettingsSave'
import RoutineEditor from './RoutineEditor.vue'

const store = useHouseholdStore()
const now = useNow(60_000)
const todayId = useId()

const children = computed(() => (store.view ? [...store.view.children].sort((a, b) => a.sortOrder - b.sortOrder) : []))
const selectedChildId = ref<string | null>(null)
const selectedChild = computed(() => children.value.find((c) => c.id === selectedChildId.value) ?? null)

watch(
  children,
  (list) => {
    if (list.length > 0 && (selectedChildId.value === null || !list.some((c) => c.id === selectedChildId.value))) {
      selectedChildId.value = list[0]!.id
    }
  },
  { immediate: true },
)

const allRoutines = computed<Routine[]>(() => store.view?.routines ?? [])
const routines = computed(() => allRoutines.value.filter((r) => r.childId === selectedChildId.value))

// ─── Editor ────────────────────────────────────────────────────────────────
/** null while closed; 'new' adds a routine; otherwise the routine being edited. */
const editing = ref<string | null>(null)
const editingRoutine = computed(() => routines.value.find((r) => r.id === editing.value) ?? null)

watch(selectedChildId, () => {
  editing.value = null
})

// ─── Today's routine ───────────────────────────────────────────────────────
const timeZone = computed(() => store.view?.household.timeZone ?? 'UTC')
const today = computed(() => householdDate(now.value, timeZone.value))
const choice = computed(() =>
  selectedChildId.value ? todaysRoutineChoice(store.view?.routineOverrides ?? [], selectedChildId.value, today.value) : null,
)
const weekdayDefault = computed(() =>
  selectedChildId.value ? routineForDay(allRoutines.value, selectedChildId.value, householdWeekday(now.value, timeZone.value), null) : null,
)
const { saving: switching, saved: switched, error: switchError, offline, save: saveSwitch } = useSettingsSave()

async function switchToday(event: Event): Promise<void> {
  const childId = selectedChildId.value
  if (!childId) return
  const value = (event.target as HTMLSelectElement).value
  const routineId = value === '' ? null : value
  const day = today.value
  await saveSwitch((api, auth) => api.setRoutineDayOverride(auth, childId, day, routineId))
}
</script>

<template>
  <section aria-labelledby="settings-routines-title" class="flex flex-col gap-5">
    <div class="flex items-center justify-between gap-4">
      <h2 id="settings-routines-title" class="text-[32px] font-semibold text-ink">Routines</h2>
      <RButton v-if="selectedChildId && editing === null" variant="primary" @click="editing = 'new'">+ New routine</RButton>
    </div>

    <RChips v-if="children.length > 0" v-model="selectedChildId" label="Child" :options="children.map((c) => ({ value: c.id, label: c.name }))" />

    <template v-if="selectedChild">
      <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
        <ul class="flex flex-col">
          <li
            v-for="routine in routines"
            :key="routine.id"
            data-testid="routine-row"
            class="flex items-center gap-4 border-b border-line py-3 last:border-b-0"
          >
            <div class="flex flex-1 flex-col gap-2">
              <span class="text-[22px] font-medium text-ink">{{ routine.name }}</span>
              <span class="flex flex-wrap gap-2">
                <span
                  v-for="day in weekdaySummary(routine.weekdays)"
                  :key="day"
                  class="rounded-full bg-surface-2 px-3 py-1 text-[18px] text-ink-2"
                >{{ day }}</span>
                <span v-if="routine.weekdays.length === 0" class="text-[18px] text-ink-3">No default days</span>
                <span class="text-[18px] text-ink-3">· {{ routine.steps.length }} {{ routine.steps.length === 1 ? 'step' : 'steps' }}</span>
              </span>
            </div>
            <RButton variant="secondary" :disabled="editing !== null" @click="editing = routine.id">Edit {{ routine.name }}</RButton>
          </li>
          <li v-if="routines.length === 0" class="py-3 text-[18px] text-ink-3">No routines yet for {{ selectedChild.name }}.</li>
        </ul>
      </div>

      <RoutineEditor
        v-if="editing !== null"
        :key="`${selectedChild.id}:${editing}`"
        :child-id="selectedChild.id"
        :routine="editingRoutine"
        :routines="allRoutines"
        @close="editing = null"
      />

      <div v-if="routines.length > 0" class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <label :for="todayId" class="text-[20px] font-medium text-ink">Switch today’s routine</label>
        <p class="text-[18px] text-ink-3">Only for today. Tomorrow goes back to the weekday default.</p>
        <select
          :id="todayId"
          :value="choice ?? ''"
          :disabled="switching || offline"
          class="min-h-[56px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
          @change="switchToday"
        >
          <option value="">Use the weekday default{{ weekdayDefault ? ` (${weekdayDefault.name})` : ' (none)' }}</option>
          <option v-for="routine in routines" :key="routine.id" :value="routine.id">{{ routine.name }}</option>
        </select>
        <p v-if="switchError" role="alert" class="text-[18px] text-warn-ink">{{ switchError }}</p>
        <p role="status" aria-live="polite" class="text-[18px] font-medium text-green-deep"><span v-if="switched">Saved</span></p>
      </div>
    </template>
  </section>
</template>
