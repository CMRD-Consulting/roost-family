import { TZDate } from '@date-fns/tz'
import { householdDate, householdWeekday } from './time'
import type { HouseholdDate, StickerEntry } from './types'

export interface StickerWeek {
  weekStart: HouseholdDate
  /** categoryId → 7 counts, Monday first */
  counts: Record<string, number[]>
}

function mondayMidnight(at: Date, timeZone: string): TZDate {
  const d = new TZDate(at.getTime(), timeZone)
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysSinceMonday)
  d.setHours(0, 0, 0, 0)
  return d
}

export function weekStartDate(at: Date, timeZone: string): HouseholdDate {
  return householdDate(new Date(mondayMidnight(at, timeZone).getTime()), timeZone)
}

export function stickerWeek(
  entries: StickerEntry[],
  childId: string,
  categoryIds: string[],
  now: Date,
  timeZone: string,
): StickerWeek {
  const start = mondayMidnight(now, timeZone)
  const end = new TZDate(start.getTime(), timeZone)
  end.setDate(end.getDate() + 7)

  const counts: Record<string, number[]> = {}
  for (const id of categoryIds) counts[id] = [0, 0, 0, 0, 0, 0, 0]

  for (const e of entries) {
    if (e.childId !== childId) continue
    const row = counts[e.categoryId]
    if (!row) continue
    const t = Date.parse(e.at)
    if (t < start.getTime() || t >= end.getTime()) continue
    const index = (householdWeekday(new Date(t), timeZone) + 6) % 7
    row[index] = (row[index] ?? 0) + 1
  }

  return { weekStart: householdDate(new Date(start.getTime()), timeZone), counts }
}
