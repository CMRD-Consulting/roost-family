<script setup lang="ts">
/**
 * Add or edit one routine (spec §7.5, §7.9): name, default weekdays and up to 20 steps (icon, label, optional
 * time), reorderable. Warns, without blocking, when a weekday is already another routine's default or timed
 * steps are out of order. Delete asks first.
 */
import { computed, ref } from 'vue'
import type { Routine } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RoutineIcon from '@/ui/RoutineIcon.vue'
import IconPicker from '../forms/IconPicker.vue'
import SaveRow from '../forms/SaveRow.vue'
import TimeField from '../forms/TimeField.vue'
import WeekdayPicker from '../forms/WeekdayPicker.vue'
import {
  addStep, emptyRoutineForm, MAX_STEPS, moveStep, removeStep, ROUTINE_NAME_MAX, routineFormFrom, STEP_LABEL_MAX,
  stepsOutOfOrder, toRoutineInput, validateRoutineForm, weekdayConflicts, type RoutineForm, type RoutineFormErrors,
} from '../routineForm'
import { useSettingsSave } from '../useSettingsSave'

const props = defineProps<{
  childId: string
  /** null adds a new routine. */
  routine: Routine | null
  /** Every routine in the household, for the weekday warning. */
  routines: Routine[]
}>()
const emit = defineEmits<{ close: [] }>()

const form = ref<RoutineForm>(props.routine ? routineFormFrom(props.routine) : emptyRoutineForm())
const errors = ref<RoutineFormErrors>({})
/** The step whose icon picker is open, by key. */
const pickingIconFor = ref<string | null>(null)

const conflicts = computed(() => weekdayConflicts(form.value.weekdays, props.childId, props.routine?.id ?? null, props.routines))
const outOfOrder = computed(() => stepsOutOfOrder(form.value.steps))

const { saving, saved, error, offline, save } = useSettingsSave()

function add(): void {
  form.value = addStep(form.value)
}
function move(index: number, direction: -1 | 1): void {
  form.value = moveStep(form.value, index, direction)
}
function remove(index: number): void {
  form.value = removeStep(form.value, index)
}

async function submit(): Promise<void> {
  errors.value = validateRoutineForm(form.value)
  if (errors.value.name || errors.value.steps) return
  const input = toRoutineInput(props.routine?.id ?? null, props.childId, form.value)
  const ok = await save((api, auth) => api.upsertRoutine(auth, input))
  if (ok) emit('close')
}

// ─── Delete ────────────────────────────────────────────────────────────────
const confirmingDelete = ref(false)
const { saving: deleting, error: deleteError, save: saveDelete } = useSettingsSave()

async function confirmDelete(): Promise<void> {
  const routineId = props.routine?.id
  if (!routineId) return
  const ok = await saveDelete((api, auth) => api.deleteRoutine(auth, routineId))
  if (ok) emit('close')
}
</script>

<template>
  <div class="flex flex-col gap-5 rounded-[var(--radius-card)] bg-surface px-6 py-5">
    <h3 class="text-[24px] font-semibold text-ink">{{ routine ? `Edit ${routine.name}` : 'New routine' }}</h3>

    <div class="flex flex-col gap-2">
      <RInput v-model="form.name" label="Routine name" autocomplete="off" :maxlength="ROUTINE_NAME_MAX" />
      <p v-if="errors.name" class="text-[18px] text-warn-ink">{{ errors.name }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <WeekdayPicker v-model="form.weekdays" label="Weekdays" />
      <p class="text-[18px] text-ink-3">The days this routine runs by default.</p>
      <p v-for="warning in conflicts" :key="warning" role="status" class="text-[18px] text-amber-deep">{{ warning }}</p>
    </div>

    <fieldset class="flex flex-col gap-3">
      <legend class="mb-2 text-[20px] font-medium text-ink">Steps</legend>
      <p v-if="outOfOrder" role="status" class="text-[18px] text-amber-deep">
        Some timed steps are out of order. Kids’ Corner follows the list order.
      </p>
      <ol class="flex flex-col gap-3">
        <li
          v-for="(step, i) in form.steps"
          :key="step.key"
          data-testid="routine-step"
          class="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-2 px-4 py-4"
        >
          <div class="flex flex-wrap items-end gap-3">
            <button
              type="button"
              :aria-label="`Choose an icon for step ${i + 1}`"
              :aria-expanded="pickingIconFor === step.key"
              class="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              @click="pickingIconFor = pickingIconFor === step.key ? null : step.key"
            >
              <RoutineIcon v-if="step.iconKey" :icon-key="step.iconKey" :size="30" />
              <span v-else class="text-[18px] text-ink-3" aria-hidden="true">Icon</span>
            </button>
            <div class="min-w-[200px] flex-1">
              <RInput v-model="step.label" :label="`Step ${i + 1} label`" autocomplete="off" :maxlength="STEP_LABEL_MAX" />
            </div>
            <div class="flex gap-2">
              <button
                type="button" :aria-label="`Move step ${i + 1} up`" :disabled="i === 0"
                class="flex size-12 items-center justify-center rounded-[12px] bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="move(i, -1)"
              >
                ↑
              </button>
              <button
                type="button" :aria-label="`Move step ${i + 1} down`" :disabled="i === form.steps.length - 1"
                class="flex size-12 items-center justify-center rounded-[12px] bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="move(i, 1)"
              >
                ↓
              </button>
              <button
                type="button" :aria-label="`Remove step ${i + 1}`"
                class="flex size-12 items-center justify-center rounded-[12px] bg-surface text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                @click="remove(i)"
              >
                ✕
              </button>
            </div>
          </div>

          <IconPicker v-if="pickingIconFor === step.key" v-model="step.iconKey" :label="`Icon for step ${i + 1}`" />

          <div class="flex flex-wrap items-end gap-4">
            <button
              type="button"
              role="switch"
              :aria-checked="step.hasTime"
              :aria-label="`Step ${i + 1} has a time`"
              class="flex min-h-[48px] items-center gap-3 rounded-[var(--radius-control)] px-1 text-[18px] text-ink-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              @click="step.hasTime = !step.hasTime"
            >
              <span class="relative h-8 w-14 rounded-full transition-colors" :class="step.hasTime ? 'bg-green-deep' : 'bg-line'" aria-hidden="true">
                <span class="absolute top-[3px] size-[26px] rounded-full bg-surface transition-[left]" :class="step.hasTime ? 'left-[27px]' : 'left-[3px]'" />
              </span>
              <span aria-hidden="true">{{ step.hasTime ? 'At a set time' : 'No time' }}</span>
            </button>
            <TimeField v-if="step.hasTime" v-model="step.time" :label="`Step ${i + 1} time`" />
          </div>

          <p v-if="errors.steps?.[step.key]" class="text-[18px] text-warn-ink">{{ errors.steps[step.key] }}</p>
        </li>
      </ol>
      <p v-if="form.steps.length === 0" class="text-[18px] text-ink-3">No steps yet.</p>
      <div>
        <RButton variant="secondary" :disabled="form.steps.length >= MAX_STEPS" @click="add">+ Add step</RButton>
        <p v-if="form.steps.length >= MAX_STEPS" class="mt-2 text-[18px] text-ink-3">A routine can have up to {{ MAX_STEPS }} steps.</p>
      </div>
    </fieldset>

    <div class="flex flex-wrap items-center gap-4">
      <RButton variant="secondary" @click="emit('close')">Cancel</RButton>
      <SaveRow :saving="saving" :saved="saved" :error="error" :disabled="offline" @save="submit" />
    </div>

    <div v-if="routine" class="flex flex-col gap-3 border-t border-line pt-4">
      <template v-if="confirmingDelete">
        <p class="text-[20px] text-ink">Delete {{ routine.name }}? Its progress and any switch to it today go too.</p>
        <div class="flex gap-3">
          <RButton variant="secondary" :disabled="deleting" @click="confirmingDelete = false">Cancel</RButton>
          <RButton variant="danger" :disabled="deleting || offline" @click="confirmDelete">Delete</RButton>
        </div>
        <p v-if="deleteError" role="alert" class="text-[18px] text-warn-ink">{{ deleteError }}</p>
      </template>
      <div v-else>
        <RButton variant="ghost" @click="confirmingDelete = true">Delete routine</RButton>
      </div>
    </div>
  </div>
</template>
