import { isInWindow, startOfHouseholdDay } from './time'
import type { Child, SleepEntry, TimeWindow } from './types'

export type SleepStatus =
  | { kind: 'sleeping'; since: Date; durationMs: number }
  | { kind: 'awake'; since: Date; durationMs: number }
  | { kind: 'unknown' }

export function nightWindowFor(child: Pick<Child, 'nightSleep'>, householdDefault: TimeWindow): TimeWindow {
  return child.nightSleep ?? householdDefault
}

export function classifySleep(startAt: Date, window: TimeWindow, timeZone: string): 'nap' | 'night' {
  return isInWindow(startAt, window, timeZone) ? 'night' : 'nap'
}

export function sleepStatus(entries: SleepEntry[], childId: string, now: Date, timeZone: string): SleepStatus {
  const mine = entries.filter((e) => e.childId === childId)

  const open = mine
    .filter((e) => e.endAt === null)
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0]
  if (open) {
    const since = new Date(open.startAt)
    return { kind: 'sleeping', since, durationMs: now.getTime() - since.getTime() }
  }

  const dayStart = startOfHouseholdDay(now, timeZone).getTime()
  const latestEnd = mine
    .map((e) => (e.endAt ? Date.parse(e.endAt) : NaN))
    .filter((t) => !Number.isNaN(t) && t >= dayStart && t <= now.getTime())
    .sort((a, b) => b - a)[0]
  if (latestEnd === undefined) return { kind: 'unknown' }

  return { kind: 'awake', since: new Date(latestEnd), durationMs: now.getTime() - latestEnd }
}
