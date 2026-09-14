import { parseHourMinute } from './time'
import type { Routine } from './types'

export function routineForDay(
  routines: Routine[],
  childId: string,
  weekday: number,
  overrideRoutineId: string | null,
): Routine | null {
  const mine = routines.filter((r) => r.childId === childId)
  if (overrideRoutineId) {
    const override = mine.find((r) => r.id === overrideRoutineId)
    if (override) return override
  }
  return mine.find((r) => r.weekdays.includes(weekday)) ?? null
}

export function currentStepIndex(routine: Routine, completed: number[], nowMinutes: number): number | null {
  const done = new Set(completed)

  // Anchor = the latest step (completed or not) whose time has passed; -1 if none.
  let anchor = -1
  routine.steps.forEach((s, i) => {
    if (s.time !== null && parseHourMinute(s.time) <= nowMinutes) anchor = i
  })

  // Current = the first unfinished step at or after the anchor. Earlier unfinished
  // steps are skipped, not revisited.
  for (let i = Math.max(anchor, 0); i < routine.steps.length; i++) {
    if (!done.has(i)) return i
  }
  return null
}

export function nextStepIndex(routine: Routine, completed: number[], current: number): number | null {
  const done = new Set(completed)
  for (let i = current + 1; i < routine.steps.length; i++) {
    if (!done.has(i)) return i
  }
  return null
}
