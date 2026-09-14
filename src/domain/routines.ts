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
  const firstOpen = routine.steps.findIndex((_, i) => !done.has(i))
  if (firstOpen === -1) return null

  let latestDue = -1
  routine.steps.forEach((s, i) => {
    if (s.time !== null && !done.has(i) && parseHourMinute(s.time) <= nowMinutes) latestDue = i
  })
  return Math.max(firstOpen, latestDue)
}

export function nextStepIndex(routine: Routine, completed: number[], current: number): number | null {
  const done = new Set(completed)
  for (let i = current + 1; i < routine.steps.length; i++) {
    if (!done.has(i)) return i
  }
  return null
}
