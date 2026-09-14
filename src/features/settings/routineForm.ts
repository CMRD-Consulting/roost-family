import type { RoutineInput } from '@/data/settingsApi'
import type { RoutineDayOverride } from '@/data/snapshot'
import { parseHourMinute } from '@/domain/time'
import type { Routine, RoutineStep } from '@/domain/types'

/** Mirrored from the database checks on `upsert_routine` (spec §7.5). */
export const ROUTINE_NAME_MAX = 40
export const STEP_LABEL_MAX = 40
export const MAX_STEPS = 20

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** One step row in the editor. `key` only identifies the row while editing (stable across reorders). */
export interface StepDraft {
  key: string
  iconKey: string | null
  photoId: string | null
  label: string
  /** Whether the step has a time; `time` is kept while this is off so turning it back on restores it. */
  hasTime: boolean
  time: string
}

/** The routine editor (spec §7.5, §7.9): a name, default weekdays and an ordered list of steps. */
export interface RoutineForm {
  name: string
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  steps: StepDraft[]
}

let nextKey = 0
function stepKey(): string {
  nextKey += 1
  return `step-${nextKey}`
}

export function emptyRoutineForm(): RoutineForm {
  return { name: '', weekdays: [], steps: [] }
}

function draftFrom(step: RoutineStep): StepDraft {
  return {
    key: stepKey(),
    iconKey: step.iconKey,
    photoId: step.photoId,
    label: step.label,
    hasTime: step.time !== null,
    time: step.time ?? '',
  }
}

export function routineFormFrom(routine: Routine): RoutineForm {
  return { name: routine.name, weekdays: [...routine.weekdays], steps: routine.steps.map(draftFrom) }
}

export interface RoutineFormErrors {
  name?: string
  /** Per step, by `StepDraft.key`. */
  steps?: Record<string, string>
}

export function validateRoutineForm(form: RoutineForm): RoutineFormErrors {
  const errors: RoutineFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give this routine a name.'
  else if ([...name].length > ROUTINE_NAME_MAX) errors.name = `Names can be up to ${ROUTINE_NAME_MAX} characters.`

  const steps: Record<string, string> = {}
  for (const step of form.steps) {
    const label = step.label.trim()
    if (!label) steps[step.key] = 'Give this step a label.'
    else if ([...label].length > STEP_LABEL_MAX) steps[step.key] = `Step labels can be up to ${STEP_LABEL_MAX} characters.`
    else if (step.hasTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(step.time)) steps[step.key] = 'Pick a time or turn off the time.'
  }
  if (Object.keys(steps).length > 0) errors.steps = steps
  return errors
}

/** Appends an empty step (no-op at the 20-step limit). */
export function addStep(form: RoutineForm): RoutineForm {
  if (form.steps.length >= MAX_STEPS) return form
  const step: StepDraft = { key: stepKey(), iconKey: null, photoId: null, label: '', hasTime: false, time: '' }
  return { ...form, steps: [...form.steps, step] }
}

export function removeStep(form: RoutineForm, index: number): RoutineForm {
  return { ...form, steps: form.steps.filter((_, i) => i !== index) }
}

/** Moves the step at `index` up (`-1`) or down (`1`); returns `form` unchanged off either end. */
export function moveStep(form: RoutineForm, index: number, direction: -1 | 1): RoutineForm {
  const target = index + direction
  if (index < 0 || index >= form.steps.length || target < 0 || target >= form.steps.length) return form
  const steps = form.steps.slice()
  ;[steps[index], steps[target]] = [steps[target]!, steps[index]!]
  return { ...form, steps }
}

/** True when a timed step comes after a later-timed one (a warning only: the adult may mean it). */
export function stepsOutOfOrder(steps: StepDraft[]): boolean {
  let previous = -1
  for (const step of steps) {
    if (!step.hasTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(step.time)) continue
    const minutes = parseHourMinute(step.time)
    if (minutes < previous) return true
    previous = minutes
  }
  return false
}

function joinDays(days: string[]): string {
  if (days.length <= 1) return days.join('')
  return `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`
}

/**
 * Warnings for weekdays the child's other routines already use (spec §7.5: each weekday has one default; when
 * two routines share a day, `routineForDay` picks the first).
 */
export function weekdayConflicts(weekdays: number[], childId: string, routineId: string | null, routines: Routine[]): string[] {
  const chosen = new Set(weekdays)
  return routines
    .filter((r) => r.childId === childId && r.id !== routineId)
    .flatMap((r) => {
      const shared = [...new Set(r.weekdays)].filter((d) => chosen.has(d)).sort((a, b) => a - b)
      if (shared.length === 0) return []
      return [`${r.name} already uses ${joinDays(shared.map((d) => WEEKDAY_LONG[d]!))} — the first routine wins.`]
    })
}

/** Short day names for a routine's weekday chips, Sunday first. */
export function weekdaySummary(weekdays: number[]): string[] {
  return [...new Set(weekdays)].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]!)
}

export function toRoutineInput(routineId: string | null, childId: string, form: RoutineForm): RoutineInput {
  return {
    routineId,
    childId,
    name: form.name.trim(),
    weekdays: [...new Set(form.weekdays)].sort((a, b) => a - b),
    steps: form.steps.map((s) => ({
      iconKey: s.iconKey,
      photoId: s.photoId,
      label: s.label.trim(),
      time: s.hasTime ? s.time : null,
    })),
  }
}

/** Today's routine switch for a child: the override's routine id, or null for "Use the weekday default". */
export function todaysRoutineChoice(overrides: RoutineDayOverride[], childId: string, day: string): string | null {
  return overrides.find((o) => o.childId === childId && o.day === day)?.routineId ?? null
}
