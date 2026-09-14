import { ageInMonths, isFeatureEnabled } from '@/domain/ageDefaults'
import { recentDoses, unacknowledgedConflicts } from '@/domain/medicine'
import { currentStepIndex, nextStepIndex, routineForDay } from '@/domain/routines'
import { sleepStatus } from '@/domain/sleep'
import { formatClock, formatDuration, householdDate, householdWeekday, minutesOfDay } from '@/domain/time'
import type { Feature } from '@/domain/types'
import type { HouseholdSnapshot, SnapshotChild } from '@/data/snapshot'

export type LogKind = 'sleep' | 'feeding' | 'medicine' | 'sticker' | 'jot' | 'grocery' | 'diaper'

export interface StepModel { label: string; iconKey: string | null }

export interface KidCardModel {
  childId: string
  name: string
  color: string
  ageLabel: string
  sleep: { kind: 'awake' | 'sleeping' | 'stale' | 'unknown'; label: string } | null
  feeding: string | null
  nowNext: { now: StepModel | null; next: StepModel | null } | null
}

export interface MedicineLineModel {
  doseChildId: string
  childName: string
  childColor: string
  medicineName: string
  givenAt: string
  givenBy: string | null
  nextAfter: string
  nextAllowed: boolean
}

export interface ConflictModel { doseId: string; childName: string; medicineName: string; message: string }

export interface MainScreenModel {
  clock: string
  dateLabel: string
  layout: 'full' | 'compact'
  kidCards: KidCardModel[]
  medicine: MedicineLineModel[]
  conflicts: ConflictModel[]
  dinner: string | null
  logButtons: LogKind[]
  /** The doses shown may be out of date (saved info, or realtime down for a while): no line reads as allowed. */
  medicineStale: boolean
  /** Sitter Mode is on for the household (spec §7.6): personal lists are hidden. */
  sitterActive: boolean
}

export interface MainScreenModelOptions {
  /** See `MainScreenModel.medicineStale`. */
  medicineStale?: boolean
}

const DAY_MS = 24 * 3_600_000
const SLEEP_LINE_LOOKBACK_MS = 18 * 3_600_000
const FEEDING_LOOKBACK_MS = 24 * 3_600_000
const dateFormatters = new Map<string, Intl.DateTimeFormat>()

/** "Monday, September 14" in the household time zone. */
export function formatDateLabel(now: Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
    dateFormatters.set(timeZone, f)
  }
  return f.format(now)
}

const shortFormatters = new Map<string, Intl.DateTimeFormat>()
function shortFormatter(key: 'weekday' | 'monthDay', timeZone: string): Intl.DateTimeFormat {
  const id = `${key}|${timeZone}`
  let f = shortFormatters.get(id)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', key === 'weekday' ? { weekday: 'short', timeZone } : { month: 'short', day: 'numeric', timeZone })
    shortFormatters.set(id, f)
  }
  return f
}

/** Whole household-calendar days from `from` to `to` (0 on the same local day). */
function householdDaysBetween(from: Date, to: Date, timeZone: string): number {
  return Math.round((Date.parse(householdDate(to, timeZone)) - Date.parse(householdDate(from, timeZone))) / DAY_MS)
}

/**
 * The header badge while the view is the device cache's saved copy: "Showing saved info from 9:42 AM" when
 * it's from today (household time zone), "… from Mon 9:42 AM" within the last 6 days, else "… from Sep 8, 9:42 AM".
 */
export function savedInfoLabel(loadedAt: Date, now: Date, timeZone: string): string {
  const time = formatClock(loadedAt, timeZone)
  const days = householdDaysBetween(loadedAt, now, timeZone)
  const when =
    days <= 0 ? time
    : days <= 6 ? `${shortFormatter('weekday', timeZone).format(loadedAt)} ${time}`
    : `${shortFormatter('monthDay', timeZone).format(loadedAt)}, ${time}`
  return `Showing saved info from ${when}`
}

export function ageLabel(months: number): string {
  if (months < 12) return `${Math.max(0, months)} mo`
  if (months < 24) return '1 yr'
  return `${Math.floor(months / 12)} yrs`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function buildMainScreenModel(s: HouseholdSnapshot, now: Date, options: MainScreenModelOptions = {}): MainScreenModel {
  const medicineStale = options.medicineStale ?? false
  const tz = s.household.timeZone
  const today = householdDate(now, tz)
  const enabled = (child: SnapshotChild, feature: Feature) =>
    isFeatureEnabled(feature, {
      birthday: child.birthday,
      today,
      overrides: child.overrides,
      diaperLogEnabled: s.household.diaperLogEnabled,
    })
  const children = [...s.children].sort((a, b) => a.sortOrder - b.sortOrder)
  const byChild = new Map(children.map((c) => [c.id, c]))
  const t = now.getTime()

  const kidCards = children.map((child): KidCardModel => {
    // "Recent" regardless of open/closed: an entry started long ago and never closed
    // shouldn't keep showing a sleep line forever on a child whose wakeWindow is off.
    const recentSleep = s.sleeps.some(
      (e) => e.childId === child.id && t - Date.parse(e.startAt) <= SLEEP_LINE_LOOKBACK_MS,
    )
    const wakeWindowOn = enabled(child, 'wakeWindow')
    let sleep: KidCardModel['sleep'] = null
    if (wakeWindowOn || recentSleep) {
      const st = sleepStatus(s.sleeps, child.id, now)
      // With the feature off, an "unknown" status (no sleep data in range) isn't worth
      // a "Log wake-up" prompt on an older kid's card — just hide the line.
      if (!(st.kind === 'unknown' && !wakeWindowOn)) {
        sleep =
          st.kind === 'awake' ? { kind: 'awake', label: `Awake ${formatDuration(st.durationMs)}` }
          : st.kind === 'sleeping' ? { kind: 'sleeping', label: `Sleeping ${formatDuration(st.durationMs)}` }
          : st.kind === 'stale' ? { kind: 'stale', label: 'Still sleeping?' }
          : { kind: 'unknown', label: 'Log wake-up' }
      }
    }

    let feeding: string | null = null
    if (enabled(child, 'feeding')) {
      const last = s.feedings
        .filter((f) => f.childId === child.id && t - Date.parse(f.at) <= FEEDING_LOOKBACK_MS && Date.parse(f.at) <= t)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
      if (last) feeding = `${capitalize(last.type)} · ${formatDuration(t - Date.parse(last.at))} ago`
    }

    let nowNext: KidCardModel['nowNext'] = null
    if (enabled(child, 'kidsCorner')) {
      const override = s.routineOverrides.find((o) => o.childId === child.id && o.day === today)
      const routine = routineForDay(s.routines, child.id, householdWeekday(now, tz), override?.routineId ?? null)
      if (routine) {
        const completed = s.routineProgress.find((p) => p.childId === child.id && p.routineId === routine.id && p.day === today)?.completed ?? []
        const current = currentStepIndex(routine, completed, minutesOfDay(now, tz))
        const next = current === null ? null : nextStepIndex(routine, completed, current)
        const step = (i: number | null): StepModel | null => {
          if (i === null) return null
          const st = routine.steps[i]
          return st ? { label: st.label, iconKey: st.iconKey } : null
        }
        nowNext = { now: step(current), next: step(next) }
      }
    }

    return {
      childId: child.id,
      name: child.name,
      color: child.color,
      ageLabel: ageLabel(ageInMonths(child.birthday, today)),
      sleep,
      feeding,
      nowNext,
    }
  })

  const medicineById = new Map(s.medicines.map((m) => [m.id, m]))
  const medicine = recentDoses(s.medicines, s.doses, now).map((d): MedicineLineModel => {
    const child = byChild.get(d.childId)
    return {
      doseChildId: d.childId,
      childName: child?.name ?? '',
      childColor: child?.color ?? '#5C6B7C',
      medicineName: d.medicineName,
      givenAt: formatClock(d.givenAt, tz),
      givenBy: d.givenBy,
      nextAfter: formatClock(d.nextAfter, tz),
      // Another adult may have given a dose we can't see yet: never show "allowed" on stale data.
      nextAllowed: d.nextAllowed && !medicineStale,
    }
  })

  const conflicts = unacknowledgedConflicts(s.medicines, s.doses).map((d): ConflictModel => {
    const childName = byChild.get(d.childId)?.name ?? ''
    const medicineName = medicineById.get(d.medicineId)?.name ?? ''
    const by = d.loggedByName ? ` by ${d.loggedByName}` : ''
    return {
      doseId: d.id,
      childName,
      medicineName,
      message: `${childName} · ${medicineName} logged offline at ${formatClock(new Date(d.at), tz)}${by} conflicts with another dose.`,
    }
  })

  // A device-cached snapshot from before sitter sessions were loaded may not have the field.
  const sitterActive = (s.activeSitterSession ?? null) !== null
  const logButtons: LogKind[] = sitterActive
    ? ['sleep', 'feeding', 'medicine', 'sticker']
    : ['sleep', 'feeding', 'medicine', 'sticker', 'jot', 'grocery']
  if (s.household.diaperLogEnabled) logButtons.push('diaper')

  return {
    clock: formatClock(now, tz),
    dateLabel: formatDateLabel(now, tz),
    layout: children.length > 4 ? 'compact' : 'full',
    kidCards,
    medicine,
    conflicts,
    dinner: s.household.dinnerTonight?.trim() || null,
    logButtons,
    medicineStale,
    sitterActive,
  }
}
