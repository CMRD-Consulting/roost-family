/**
 * Provider-neutral calendar event shaping (spec §5.5, §7.2, §11.2).
 *
 * Every provider (ICS, Google, Microsoft) maps its events to `SourceEvent`; `mergeDayEvents` then attaches the
 * selection's person and color, keeps only events overlapping the household day, and rebuilds each object from an
 * allow-list so descriptions, attendees, links and organizers can never leak through. Event data is never stored.
 *
 * Plain TypeScript only (no Deno or Node globals beyond `Intl`), so Vitest and the Edge Functions share it.
 */

export const UNTITLED_EVENT_TITLE = '(No title)'
const TITLE_MAX = 200
const LOCATION_MAX = 200

/** One event occurrence as a provider reports it, already reduced to the fields Roost may show. */
export interface SourceEvent {
  title: string
  /** ISO 8601 UTC instant. For all-day events, midnight in the household zone. */
  startAt: string
  /** ISO 8601 UTC instant (exclusive). */
  endAt: string
  allDay: boolean
  location: string | null
}

/** The calendar selection an event came from: who it is assigned to and the color to draw it with. */
export interface SelectionMeta {
  personType: 'member' | 'child'
  personId: string
  calendarColor: string
}

export interface DayEvent extends SourceEvent, SelectionMeta {}

/** [dayStartUtc, dayEndUtc): the household's current day, 00:00 to 24:00 local time. */
export interface DayWindow {
  dayStartUtc: Date
  dayEndUtc: Date
}

export interface WallTime {
  year: number
  /** 1-12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock reading in `timeZone` at the instant `utcMs`. */
export function wallTimeAt(utcMs: number, timeZone: string): WallTime {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  const parts: Record<string, number> = {}
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  }
}

function wallTimeAsUtcMs(t: WallTime): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
}

/** `timeZone`'s offset from UTC (ms, east positive) at the instant `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(utcMs / 1000) * 1000
  return wallTimeAsUtcMs(wallTimeAt(wholeSecond, timeZone)) - wholeSecond
}

/**
 * The UTC instant at which the clock in `timeZone` reads `wall`. For a repeated hour (fall back) the earlier
 * instant wins; for a skipped hour (spring forward) the time is read with the pre-change offset.
 */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const asUtc = wallTimeAsUtcMs(wall)
  const offsetBefore = offsetMs(asUtc - 86_400_000, timeZone)
  const offsetAfter = offsetMs(asUtc + 86_400_000, timeZone)
  const earlier = asUtc - Math.max(offsetBefore, offsetAfter)
  const later = asUtc - Math.min(offsetBefore, offsetAfter)
  for (const candidate of [earlier, later]) {
    if (wallTimeAsUtcMs(wallTimeAt(candidate, timeZone)) === asUtc) return new Date(candidate)
  }
  // Skipped wall time (spring forward): interpret it with the offset in effect before the change.
  return new Date(asUtc - offsetBefore)
}

/** Today's household day (00:00 to the next 00:00 local) containing `now`. 23 or 25 hours on DST days. */
export function householdDayWindow(now: Date, timeZone: string): DayWindow {
  const today = wallTimeAt(now.getTime(), timeZone)
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
  return {
    dayStartUtc: zonedWallTimeToUtc({ year: today.year, month: today.month, day: today.day, hour: 0, minute: 0, second: 0 }, timeZone),
    dayEndUtc: zonedWallTimeToUtc(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0 },
      timeZone,
    ),
  }
}

/** True when [startMs, endMs) overlaps the window; a zero-length event counts when it sits inside the window. */
export function overlapsWindow(startMs: number, endMs: number, window: DayWindow): boolean {
  const dayStart = window.dayStartUtc.getTime()
  const dayEnd = window.dayEndUtc.getTime()
  if (startMs >= dayEnd) return false
  return endMs > dayStart || (endMs <= startMs && startMs >= dayStart)
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Normalizes a title: collapses whitespace, caps length, and substitutes a placeholder for blanks. */
export function cleanTitle(title: unknown): string {
  const text = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : ''
  return text ? cap(text, TITLE_MAX) : UNTITLED_EVENT_TITLE
}

export function cleanLocation(location: unknown): string | null {
  const text = typeof location === 'string' ? location.replace(/\s+/g, ' ').trim() : ''
  return text ? cap(text, LOCATION_MAX) : null
}

/** All-day first, then by start, end and title. */
export function compareEvents(a: SourceEvent, b: SourceEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  return (
    Date.parse(a.startAt) - Date.parse(b.startAt) ||
    Date.parse(a.endAt) - Date.parse(b.endAt) ||
    (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
  )
}

/**
 * Combines the events of each visible selection into the Today list: attaches person and color, keeps events
 * overlapping the household day (including those already in progress, with their real start and end), drops
 * invalid ones, and sorts. Output objects contain only the allow-listed fields.
 */
export function mergeDayEvents(
  sources: ReadonlyArray<{ selection: SelectionMeta; events: ReadonlyArray<SourceEvent> }>,
  window: DayWindow,
): DayEvent[] {
  const merged: DayEvent[] = []
  for (const { selection, events } of sources) {
    for (const event of events) {
      const startMs = Date.parse(event.startAt)
      const endMs = Date.parse(event.endAt)
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue
      if (!overlapsWindow(startMs, endMs, window)) continue
      merged.push({
        title: cleanTitle(event.title),
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(Math.max(startMs, endMs)).toISOString(),
        allDay: event.allDay === true,
        location: cleanLocation(event.location),
        personType: selection.personType,
        personId: selection.personId,
        calendarColor: selection.calendarColor,
      })
    }
  }
  return merged.sort(compareEvents)
}
