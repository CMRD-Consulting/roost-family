/**
 * Pure view models for Kids' Corner (spec §7.5): which children can play, today's picture schedule, the
 * command that finishes the current step, and this week's sticker grid.
 */
import { isFeatureEnabled } from '@/domain/ageDefaults'
import { currentStepIndex, nextStepIndex, routineForDay } from '@/domain/routines'
import { stickerWeek } from '@/domain/stickers'
import { householdDate, householdWeekday, minutesOfDay } from '@/domain/time'
import type { HouseholdDate, HourMinute } from '@/domain/types'
import type { LogCommand } from '@/data/logCommands'
import type { HouseholdSnapshot, SnapshotChild } from '@/data/snapshot'

export type RoutineStepCommand = Extract<LogCommand, { kind: 'routine.step' }>

export interface ScheduleStep {
  index: number
  label: string
  iconKey: string | null
  time: HourMinute | null
  done: boolean
}

export interface ScheduleModel {
  householdId: string
  childId: string
  routineId: string
  day: HouseholdDate
  steps: ScheduleStep[]
  currentIndex: number | null
  nextIndex: number | null
  completed: number[]
}

export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface StickerGridRow {
  categoryId: string
  name: string
  iconKey: string
  /** Seven counts, Monday first. */
  counts: number[]
}

export interface StickerGridModel {
  weekStart: HouseholdDate
  days: readonly string[]
  /** 0 = Monday … 6 = Sunday, in the household time zone. */
  todayIndex: number
  rows: StickerGridRow[]
}

/** Children with Kids' Corner enabled (by age or a per-child override), in the household's order. */
export function cornerChildren(snapshot: HouseholdSnapshot, now: Date): SnapshotChild[] {
  const today = householdDate(now, snapshot.household.timeZone)
  return snapshot.children
    .filter((child) =>
      isFeatureEnabled('kidsCorner', {
        birthday: child.birthday,
        today,
        overrides: child.overrides,
        diaperLogEnabled: snapshot.household.diaperLogEnabled,
      }),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Today's routine for the child (the day override wins over the weekday default), or null if there is none. */
export function scheduleModel(snapshot: HouseholdSnapshot, childId: string, now: Date): ScheduleModel | null {
  const tz = snapshot.household.timeZone
  const day = householdDate(now, tz)
  const override = snapshot.routineOverrides.find((o) => o.childId === childId && o.day === day)
  const routine = routineForDay(snapshot.routines, childId, householdWeekday(now, tz), override?.routineId ?? null)
  if (routine === null) return null

  const completed =
    snapshot.routineProgress.find((p) => p.childId === childId && p.routineId === routine.id && p.day === day)
      ?.completed ?? []
  const done = new Set(completed)
  const currentIndex = currentStepIndex(routine, completed, minutesOfDay(now, tz))
  return {
    householdId: snapshot.household.id,
    childId,
    routineId: routine.id,
    day,
    steps: routine.steps.map((step, index) => ({
      index,
      label: step.label,
      iconKey: step.iconKey,
      time: step.time,
      done: done.has(index),
    })),
    currentIndex,
    nextIndex: currentIndex === null ? null : nextStepIndex(routine, completed, currentIndex),
    completed: [...completed],
  }
}

/** The `routine.step` command that marks the current step done, or null when no step is current. */
export function completeCurrent(model: ScheduleModel): RoutineStepCommand | null {
  if (model.currentIndex === null) return null
  return {
    kind: 'routine.step',
    householdId: model.householdId,
    childId: model.childId,
    routineId: model.routineId,
    day: model.day,
    stepIndex: model.currentIndex,
    done: true,
  }
}

/** This week's stickers (Mon–Sun, household time) per category, for the read-only sticker chart. */
export function stickerGridModel(snapshot: HouseholdSnapshot, childId: string, now: Date): StickerGridModel {
  const tz = snapshot.household.timeZone
  const categories = [...snapshot.stickerCategories].sort((a, b) => a.sortOrder - b.sortOrder)
  const week = stickerWeek(snapshot.stickers, childId, categories.map((c) => c.id), now, tz)
  return {
    weekStart: week.weekStart,
    days: WEEK_DAYS,
    todayIndex: (householdWeekday(now, tz) + 6) % 7,
    rows: categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      iconKey: c.iconKey,
      counts: week.counts[c.id] ?? [0, 0, 0, 0, 0, 0, 0],
    })),
  }
}
