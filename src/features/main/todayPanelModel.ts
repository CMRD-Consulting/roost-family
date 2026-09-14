/**
 * The Today panel (spec §7.2, §13): today's calendar events from now through the end of the household's day, all-day
 * events first, then by start. Ended events drop off; events in progress show "Now". Events with a location starting
 * within 2 hours show a leave-by (event start − the household's buffer, `leaveInMinutes`).
 */
import type { TodayEvents } from '@/data/calendarApi'
import { leaveInMinutes } from '@/domain/leaveBy'
import { formatClock } from '@/domain/time'

/** Past this age the panel says when the calendar was last updated. */
export const CALENDAR_STALE_MS = 30 * 60_000

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

export interface TodayModel {
  rows: TodayRow[]
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

  const rows: TodayRow[] = (result?.events ?? [])
    .filter((e) => Date.parse(e.endAt) > t)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt) || a.title.localeCompare(b.title)
    })
    .map((e, i) => {
      const start = new Date(e.startAt)
      const end = new Date(e.endAt)
      const inProgress = !e.allDay && start.getTime() <= t
      const person = people.get(`${e.personType}:${e.personId}`) ?? null
      const minutes = leaveInMinutes(e, now, input.leaveByBufferMin)
      return {
        key: `${i}:${e.personType}:${e.personId}:${e.startAt}:${e.title}`,
        title: e.title,
        time: e.allDay ? 'All day' : inProgress ? `Now · until ${formatClock(end, timeZone)}` : timeRange(start, end, timeZone),
        now: inProgress,
        location: e.location,
        leave: minutes === null ? null : leaveLabel(minutes),
        person,
        barColor: e.calendarColor || person?.color || 'var(--color-line)',
      }
    })

  const connections = result?.connections ?? []
  const reconnect = [...new Set(connections.filter((c) => c.status === 'auth_expired').map((c) => c.ownerName.trim()))].map((name) =>
    name ? `${name}’s calendar needs reconnecting` : 'A calendar needs reconnecting',
  )
  const allUnreachable = connections.length > 0 && connections.every((c) => c.status === 'unreachable')
  const unreachable = rows.length === 0 && (result ? allUnreachable : input.failed)
  const age = result ? t - Date.parse(result.updatedAt) : 0

  return {
    rows,
    reconnect,
    unreachable,
    empty: result !== null && rows.length === 0 && !unreachable,
    stale: result && age > CALENDAR_STALE_MS ? ageLabel(age) : null,
  }
}
