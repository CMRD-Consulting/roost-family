/**
 * The Today panel (spec §7.2, §13): today's calendar events from now through the end of the household's day, all-day
 * events first, then by start. Ended events drop off; events in progress show "Now". Events with a location starting
 * within 2 hours show a leave-by (event start − the household's buffer, `leaveInMinutes`).
 *
 * Whatever room today leaves goes to tomorrow, under its own heading: by the evening — when the next morning is what
 * anyone standing at the tablet wants to know — today's list has usually emptied itself. Today is never shortened to
 * make room, and the split is made against this device's clock, so tomorrow's events become today's at midnight
 * without waiting for the next refresh.
 */
import type { TodayEvents } from '@/data/calendarApi'
import { leaveInMinutes } from '@/domain/leaveBy'
import { formatClock, startOfHouseholdDay } from '@/domain/time'

/** Past this age the panel says when the calendar was last updated. */
export const CALENDAR_STALE_MS = 30 * 60_000

/** Rows the panel's column fits at the spec's text sizes; tomorrow gets what today doesn't use. */
export const MAX_PANEL_ROWS = 6

export interface TodayRow {
  key: string
  title: string
  /** "All day", "4:00 – 4:45 PM", or "Now · until 3:30 PM". */
  time: string
  now: boolean
  location: string | null
  leave: string | null
  /** The person the calendar belongs to, or null when they are no longer in the household. */
  person: { name: string; color: string } | null
  barColor: string
}

/** Tomorrow's events, when any fit under today's (spec §7.2). */
export interface TomorrowSection {
  /** "Tomorrow · Tue". */
  label: string
  rows: TodayRow[]
  /** Events that didn't fit, for "+2 more tomorrow". */
  more: number
}

export interface TodayModel {
  rows: TodayRow[]
  tomorrow: TomorrowSection | null
  /** "Sam’s calendar needs reconnecting", once per adult. */
  reconnect: string[]
  /** "Calendar couldn’t be reached": nothing to show and no calendar answered. */
  unreachable: boolean
  /** "Nothing else today". */
  empty: boolean
  stale: string | null
}

export interface TodayModelInput {
  events: TodayEvents | null
  failed: boolean
  now: Date
  timeZone: string
  leaveByBufferMin: number
  members: ReadonlyArray<{ id: string; displayName: string; color: string }>
  children: ReadonlyArray<{ id: string; name: string; color: string }>
}

export function leaveLabel(minutes: number): string {
  if (minutes <= 0) return 'Leave now'
  if (minutes < 60) return `Leave in ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `Leave in ${h} h` : `Leave in ${h} h ${m} min`
}

/** "4:00 – 4:45 PM" when both are AM or both PM, otherwise "11:30 AM – 3:30 PM". */
function timeRange(start: Date, end: Date, timeZone: string): string {
  const a = formatClock(start, timeZone)
  const b = formatClock(end, timeZone)
  const [aTime, aSuffix] = a.split(' ')
  const [, bSuffix] = b.split(' ')
  return aSuffix && aSuffix === bSuffix ? `${aTime} – ${b}` : `${a} – ${b}`
}

function ageLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `Calendar updated ${minutes} min ago` : `Calendar updated ${Math.floor(minutes / 60)} h ago`
}

export function buildTodayModel(input: TodayModelInput): TodayModel {
  const { events: result, now, timeZone } = input
  const t = now.getTime()
  const people = new Map<string, { name: string; color: string }>([
    ...input.members.map((m) => [`member:${m.id}`, { name: m.displayName, color: m.color }] as const),
    ...input.children.map((c) => [`child:${c.id}`, { name: c.name, color: c.color }] as const),
  ])

  // Tomorrow's own midnights, found by stepping 36 hours into it: a 23- or 25-hour day never lands short or long.
  const tomorrowStart = startOfHouseholdDay(new Date(startOfHouseholdDay(now, timeZone).getTime() + 36 * 3_600_000), timeZone).getTime()
  const dayAfterStart = startOfHouseholdDay(new Date(tomorrowStart + 36 * 3_600_000), timeZone).getTime()
  const all = result?.events ?? []

  const build = (list: typeof all): TodayRow[] => list
    .slice()
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt) || a.title.localeCompare(b.title)
    })
    .map((e) => {
      const start = new Date(e.startAt)
      const end = new Date(e.endAt)
      const inProgress = !e.allDay && start.getTime() <= t
      const person = people.get(`${e.personType}:${e.personId}`) ?? null
      const minutes = leaveInMinutes(e, now, input.leaveByBufferMin)
      return {
        key: `${e.personType}:${e.personId}:${e.startAt}:${e.endAt}:${e.title}`,
        title: e.title,
        time: e.allDay ? 'All day' : inProgress ? `Now · until ${formatClock(end, timeZone)}` : timeRange(start, end, timeZone),
        now: inProgress,
        location: e.location,
        leave: minutes === null ? null : leaveLabel(minutes),
        person,
        barColor: e.calendarColor || person?.color || 'var(--color-line)',
      }
    })

  // Today: still running, and starting before tomorrow begins.
  const rows = build(all.filter((e) => Date.parse(e.endAt) > t && Date.parse(e.startAt) < tomorrowStart))
  // Tomorrow: inside tomorrow's day. A timed event that runs past midnight belongs to the evening it started, so it
  // stays under today alone; an all-day event across both is shown under each.
  const tomorrowRows = build(
    all.filter(
      (e) =>
        Date.parse(e.endAt) > tomorrowStart &&
        Date.parse(e.startAt) < dayAfterStart &&
        (e.allDay || Date.parse(e.startAt) >= tomorrowStart),
    ),
  )

  // Identical events (e.g. the same event in two calendars of one person) get a numbered key, in list order.
  const seen = new Map<string, number>()
  for (const row of [...rows, ...tomorrowRows]) {
    const n = seen.get(row.key) ?? 0
    seen.set(row.key, n + 1)
    if (n > 0) row.key = `${row.key}#${n}`
  }

  const room = Math.max(0, MAX_PANEL_ROWS - rows.length)
  const tomorrow: TomorrowSection | null =
    tomorrowRows.length > 0 && room > 0
      ? {
          label: `Tomorrow · ${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(new Date(tomorrowStart))}`,
          rows: tomorrowRows.slice(0, room),
          more: Math.max(0, tomorrowRows.length - room),
        }
      : null

  const connections = result?.connections ?? []
  const reconnect = [...new Set(connections.filter((c) => c.status === 'auth_expired').map((c) => c.ownerName.trim()))].map((name) =>
    name ? `${name}’s calendar needs reconnecting` : 'A calendar needs reconnecting',
  )
  const allUnreachable = connections.length > 0 && connections.every((c) => c.status === 'unreachable')
  const unreachable = rows.length === 0 && (result ? allUnreachable : input.failed)
  // Judged by when this device received the answer: the server's clock may differ from the tablet's.
  const age = result ? t - Date.parse(result.receivedAt) : 0

  return {
    rows,
    tomorrow,
    reconnect,
    unreachable,
    empty: result !== null && rows.length === 0 && !unreachable,
    stale: result && age > CALENDAR_STALE_MS ? ageLabel(age) : null,
  }
}
