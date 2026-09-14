import { TZDate } from '@date-fns/tz'
import type { HouseholdDate, HourMinute, TimeWindow } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function parseHourMinute(hm: HourMinute): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm)
  if (!match) throw new Error(`Invalid time "${hm}"`)
  return Number(match[1]) * 60 + Number(match[2])
}

export function minutesOfDay(at: Date, timeZone: string): number {
  const d = new TZDate(at.getTime(), timeZone)
  return d.getHours() * 60 + d.getMinutes()
}

/** Start inclusive, end exclusive. A window whose end is before its start crosses midnight. */
export function isInWindow(at: Date, window: TimeWindow, timeZone: string): boolean {
  const m = minutesOfDay(at, timeZone)
  const start = parseHourMinute(window.start)
  const end = parseHourMinute(window.end)
  return start <= end ? m >= start && m < end : m >= start || m < end
}

export function householdDate(at: Date, timeZone: string): HouseholdDate {
  const d = new TZDate(at.getTime(), timeZone)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfHouseholdDay(at: Date, timeZone: string): Date {
  const d = new TZDate(at.getTime(), timeZone)
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime())
}

export function householdWeekday(at: Date, timeZone: string): number {
  return new TZDate(at.getTime(), timeZone).getDay()
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** Some ICU builds separate the time from AM/PM with U+202F (narrow no-break
 * space) instead of a regular space; normalize it so layout and tests see ' '. */
export function normalizeSpaces(s: string): string {
  return s.replace(/ /g, ' ')
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>()

function clockFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = clockFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    clockFormatters.set(timeZone, formatter)
  }
  return formatter
}

export function formatClock(at: Date, timeZone: string): string {
  return normalizeSpaces(clockFormatterFor(timeZone).format(at))
}
