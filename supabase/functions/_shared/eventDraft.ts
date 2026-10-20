/**
 * The one event an adult is adding, checked and normalised before any provider sees it (spec §5.5, §7.2).
 *
 * Roost writes the event to the connected Google or Microsoft calendar and stores nothing (§11.2), so this module is
 * the only validation there is: it decides what a title, a location and a pair of times may be, and turns both
 * shapes — a timed event given as two instants, an all-day event given as two household dates — into one draft
 * carrying both readings, which the provider modules then render their own way.
 *
 * Plain TypeScript only, so Vitest and the Edge Function share it.
 */
import { isValidTimeZone, wallTimeAt, zonedWallTimeToUtc } from './events.ts'

export const EVENT_TITLE_MAX = 200
export const EVENT_LOCATION_MAX = 200
/** How far from now an event may start or end: about a year either side. */
export const EVENT_HORIZON_DAYS = 370
/** The longest single event (an all-day stretch of a month is plenty; anything longer is a mistake). */
export const EVENT_MAX_DAYS = 31

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** An instant: a date, a time, and an explicit offset or `Z`. A bare wall time would be ambiguous. */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i
/** Anything that could start markup, plus control characters, is refused rather than silently stripped. */
const MARKUP_RE = /[<>]/
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** A rejected request. The message is safe to show: it never echoes the title or the location. */
export class EventInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventInputError'
  }
}

/** What the request asked for, unchecked. */
export interface EventDraftInput {
  title?: unknown
  start?: unknown
  end?: unknown
  allDay?: unknown
  location?: unknown
}

/**
 * One event, in both readings a provider may need. For an all-day event the dates are what matters and the instants
 * are their midnights in the household zone; for a timed event it is the other way round.
 */
export interface EventDraft {
  title: string
  location: string | null
  allDay: boolean
  startAt: Date
  /** Exclusive, as everywhere else in Roost. */
  endAt: Date
  /** `YYYY-MM-DD` in the household zone. */
  startDate: string
  /** `YYYY-MM-DD` in the household zone, exclusive. */
  endDate: string
  timeZone: string
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** `YYYY-MM-DD` for the household day containing `instant`. */
export function householdDateOf(instant: Date, timeZone: string): string {
  const w = wallTimeAt(instant.getTime(), timeZone)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`
}

/** `YYYY-MM-DDTHH:mm:ss` as the clock in `timeZone` reads at `instant` (Microsoft Graph's `dateTime`). */
export function wallClockOf(instant: Date, timeZone: string): string {
  const w = wallTimeAt(instant.getTime(), timeZone)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}T${pad(w.hour, 2)}:${pad(w.minute, 2)}:${pad(w.second, 2)}`
}

/** Midnight at the start of `date` (`YYYY-MM-DD`) in `timeZone`. */
export function midnightOf(date: string, timeZone: string): Date {
  return zonedWallTimeToUtc(
    { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour: 0, minute: 0, second: 0 },
    timeZone,
  )
}

/** `date` shifted by whole days, staying a calendar date (never an instant, so DST cannot move it). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
}

/** True for a real calendar date: `2026-02-30` and `2026-13-01` are not. */
function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const [y, m, d] = [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))]
  if (y < 1970 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string') throw new EventInputError(`a ${what} is required`)
  if (CONTROL_RE.test(value)) throw new EventInputError(`a ${what} cannot contain control characters`)
  if (MARKUP_RE.test(value)) throw new EventInputError(`a ${what} cannot contain < or >`)
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length > max) throw new EventInputError(`a ${what} must be at most ${max} characters`)
  return cleaned
}

function instant(value: unknown, what: string): Date {
  if (typeof value !== 'string' || !INSTANT_RE.test(value)) {
    throw new EventInputError(`${what} must be a date and time with a time zone offset`)
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new EventInputError(`${what} is not a real time`)
  return new Date(ms)
}

function date(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isRealDate(value)) throw new EventInputError(`${what} must be a date as YYYY-MM-DD`)
  return value
}

/**
 * The checked draft, or `EventInputError`.
 *
 * `allDay` decides how `start` and `end` are read: dates (`YYYY-MM-DD`, end exclusive) for an all-day event, instants
 * with an offset for a timed one. Either way the end must be after the start, the whole event must sit within about a
 * year of `now`, and it may not run longer than a month.
 */
export function parseEventDraft(input: EventDraftInput, householdTimeZone: string, now: Date): EventDraft {
  const timeZone = isValidTimeZone(householdTimeZone) ? householdTimeZone : 'UTC'

  const title = text(input.title, 'title', EVENT_TITLE_MAX)
  if (!title) throw new EventInputError('a title is required')
  const rawLocation = input.location
  const location = rawLocation === undefined || rawLocation === null ? null : text(rawLocation, 'location', EVENT_LOCATION_MAX) || null

  if (typeof input.allDay !== 'boolean') throw new EventInputError('allDay must be true or false')
  const allDay = input.allDay

  let startAt: Date
  let endAt: Date
  let startDate: string
  let endDate: string
  if (allDay) {
    startDate = date(input.start, 'start')
    endDate = date(input.end, 'end')
    if (endDate <= startDate) throw new EventInputError('an all-day event must end on a later date than it starts')
    startAt = midnightOf(startDate, timeZone)
    endAt = midnightOf(endDate, timeZone)
  } else {
    startAt = instant(input.start, 'start')
    endAt = instant(input.end, 'end')
    if (endAt.getTime() <= startAt.getTime()) throw new EventInputError('an event must end after it starts')
    startDate = householdDateOf(startAt, timeZone)
    endDate = householdDateOf(endAt, timeZone)
  }

  if (endAt.getTime() - startAt.getTime() > EVENT_MAX_DAYS * DAY_MS) {
    throw new EventInputError(`an event can be at most ${EVENT_MAX_DAYS} days long`)
  }
  const horizon = EVENT_HORIZON_DAYS * DAY_MS
  if (Math.abs(startAt.getTime() - now.getTime()) > horizon || endAt.getTime() - now.getTime() > horizon) {
    throw new EventInputError('an event must be within about a year from now')
  }

  return { title, location, allDay, startAt, endAt, startDate, endDate, timeZone }
}
