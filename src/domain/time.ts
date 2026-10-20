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

/**
 * The instant at which the clock in `timeZone` reads `date` (`YYYY-MM-DD`) at `hm` (`HH:MM`) — what an adult means
 * when they add an event for "tomorrow at 4:00 PM". On the hour a zone repeats (falling back) the later instant is
 * taken; on one it skips (springing forward) the time shifts forward with the offset, as a calendar app does.
 */
export function householdWallTime(date: HouseholdDate, hm: HourMinute, timeZone: string): Date {
  const minutes = parseHourMinute(hm)
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid date "${date}"`)
  return new Date(new TZDate(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, timeZone).getTime())
}

/** `date` (`YYYY-MM-DD`) shifted by whole days, staying a calendar date, so a 23- or 25-hour day cannot move it. */
export function shiftHouseholdDate(date: HouseholdDate, days: number): HouseholdDate {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid date "${date}"`)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
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
