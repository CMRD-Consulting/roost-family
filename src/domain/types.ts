/** ISO 8601 timestamp in UTC, e.g. "2026-09-14T19:10:00.000Z" */
export type IsoTimestamp = string
/** Calendar date in the household time zone, "YYYY-MM-DD" */
export type HouseholdDate = string
/** Wall-clock time in the household time zone, "HH:mm" (24h) */
export type HourMinute = string

export interface TimeWindow {
  start: HourMinute
  end: HourMinute
}

export interface Child {
  id: string
  name: string
  birthday: HouseholdDate
  color: string
  /** null = use the household default window */
  nightSleep: TimeWindow | null
}

export interface SleepEntry {
  id: string
  childId: string
  startAt: IsoTimestamp
  endAt: IsoTimestamp | null
  type: 'nap' | 'night'
  /** The sitter session it was logged in, or null for a log by an adult or display outside Sitter Mode. */
  sitterSessionId: string | null
}

export interface FeedingEntry {
  id: string
  childId: string
  at: IsoTimestamp
  type: 'milk' | 'meal' | 'snack'
  amount: string | null
  note: string | null
  /** The sitter session it was logged in, or null for a log by an adult or display outside Sitter Mode. */
  sitterSessionId: string | null
}

export interface DiaperEntry {
  id: string
  childId: string
  at: IsoTimestamp
  kind: 'wet' | 'dirty' | 'both'
  /** The sitter session it was logged in, or null for a log by an adult or display outside Sitter Mode. */
  sitterSessionId: string | null
}

export interface Medicine {
  id: string
  childId: string
  name: string
  minIntervalHours: number
  maxDosesPer24h: number | null
}

export interface DoseEntry {
  id: string
  childId: string
  medicineId: string
  at: IsoTimestamp
  loggedByName: string | null
  loggedOffline: boolean
  voidedAt: IsoTimestamp | null
  conflictAcknowledgedAt: IsoTimestamp | null
  /** Server insert time (= sync time for offline-logged doses). */
  createdAt: IsoTimestamp
  note: string | null
  /** Warning kinds (e.g. "early", "overMax") the logging adult confirmed past. */
  warningsConfirmed: string[]
  /** The sitter session it was logged in, or null for a log by an adult or display outside Sitter Mode. */
  sitterSessionId: string | null
}

export interface StickerEntry {
  id: string
  childId: string
  categoryId: string
  at: IsoTimestamp
  /** The sitter session it was logged in, or null for a log by an adult or display outside Sitter Mode. */
  sitterSessionId: string | null
}

export interface RoutineStep {
  iconKey: string | null
  photoId: string | null
  label: string
  time: HourMinute | null
}

export interface Routine {
  id: string
  childId: string
  name: string
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  steps: RoutineStep[]
}

export interface CalendarEvent {
  title: string
  startAt: IsoTimestamp
  endAt: IsoTimestamp
  allDay: boolean
  location: string | null
}

export type Feature = 'wakeWindow' | 'feeding' | 'kidsCorner' | 'diaper'
