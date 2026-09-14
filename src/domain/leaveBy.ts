import type { CalendarEvent } from './types'

const HORIZON_MS = 2 * 3_600_000

export function leaveInMinutes(event: CalendarEvent, now: Date, bufferMinutes: number): number | null {
  if (!event.location || event.allDay) return null
  const start = Date.parse(event.startAt)
  const t = now.getTime()
  if (start <= t || start - t > HORIZON_MS) return null
  return Math.max(0, Math.floor((start - bufferMinutes * 60_000 - t) / 60_000))
}
