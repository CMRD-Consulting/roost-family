import { isInWindow } from './time'
import type { Child, SleepEntry, TimeWindow } from './types'

/** An open sleep started this long ago or more is probably a forgotten "End sleep". */
export const STALE_SLEEP_MS = 16 * 60 * 60 * 1000
/** How far back to look for a sleep that ended, for the wake-window "awake since". */
export const WAKE_WINDOW_LOOKBACK_MS = 18 * 60 * 60 * 1000

export type SleepStatus =
  | { kind: 'sleeping'; since: Date; durationMs: number }
  | { kind: 'awake'; since: Date; durationMs: number }
  | { kind: 'stale'; since: Date }
  | { kind: 'unknown' }

export function nightWindowFor(child: Pick<Child, 'nightSleep'>, householdDefault: TimeWindow): TimeWindow {
  return child.nightSleep ?? householdDefault
}

export function classifySleep(startAt: Date, window: TimeWindow, timeZone: string): 'nap' | 'night' {
  return isInWindow(startAt, window, timeZone) ? 'night' : 'nap'
}

export function sleepStatus(entries: SleepEntry[], childId: string, now: Date): SleepStatus {
  const mine = entries.filter((e) => e.childId === childId)
  const nowMs = now.getTime()

  // An open entry is superseded (and ignored) if some sleep for this child ended
  // after it started — it's a stray, not the current sleep.
  const isSuperseded = (open: SleepEntry) => {
    const openStart = Date.parse(open.startAt)
    return mine.some((e) => e.endAt !== null && Date.parse(e.endAt) > openStart)
  }

  const open = mine
    .filter((e) => e.endAt === null && !isSuperseded(e))
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0]
  if (open) {
    const startMs = Date.parse(open.startAt)
    const since = new Date(startMs)
    if (nowMs - startMs > STALE_SLEEP_MS) {
      return { kind: 'stale', since }
    }
    return { kind: 'sleeping', since, durationMs: Math.max(0, nowMs - startMs) }
  }

  const latestEnd = mine
    .map((e) => (e.endAt ? Date.parse(e.endAt) : NaN))
    .filter((t) => !Number.isNaN(t) && t <= nowMs && nowMs - t <= WAKE_WINDOW_LOOKBACK_MS)
    .sort((a, b) => b - a)[0]
  if (latestEnd === undefined) return { kind: 'unknown' }

  return { kind: 'awake', since: new Date(latestEnd), durationMs: nowMs - latestEnd }
}
