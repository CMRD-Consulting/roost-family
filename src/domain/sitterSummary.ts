import { STALE_SLEEP_MS } from './sleep'
import type { DiaperEntry, DoseEntry, FeedingEntry, IsoTimestamp, SleepEntry, StickerEntry } from './types'

export interface SessionRange {
  id: string
  startAt: IsoTimestamp
  endAt: IsoTimestamp | null
}

export interface SummaryData {
  sleeps: SleepEntry[]
  feedings: FeedingEntry[]
  doses: DoseEntry[]
  stickers: StickerEntry[]
  diapers: DiaperEntry[]
}

export interface ChildSummary extends SummaryData {
  childId: string
}

/**
 * What the sitter logged during a session (spec §7.6), per child, oldest first. Entries count by their attribution to
 * the session, not by time: a sitter's backdated or clock-skewed log is included, and an adult's log made while the
 * sitter was on is not.
 */
export function sitterSummary(
  session: SessionRange,
  children: { id: string }[],
  data: SummaryData,
  now: Date,
): ChildSummary[] {
  const end = session.endAt ? Date.parse(session.endAt) : now.getTime()
  // A device-cached entry from before attribution was loaded has no sitterSessionId: it doesn't count.
  const inSession = (e: { sitterSessionId?: string | null }) => e.sitterSessionId === session.id
  const byTime = <T extends { at: string }>(a: T, b: T) => Date.parse(a.at) - Date.parse(b.at)

  return children.map(({ id }) => ({
    childId: id,
    sleeps: data.sleeps
      .filter((s) => {
        if (s.childId !== id || !inSession(s)) return false
        // An open sleep that started long before the session ended isn't "still going" — it's a forgotten
        // End sleep and shouldn't inflate the summary.
        if (s.endAt === null && end - Date.parse(s.startAt) > STALE_SLEEP_MS) return false
        return true
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    feedings: data.feedings.filter((f) => f.childId === id && inSession(f)).sort(byTime),
    doses: data.doses.filter((d) => d.childId === id && inSession(d)).sort(byTime),
    stickers: data.stickers.filter((s) => s.childId === id && inSession(s)).sort(byTime),
    diapers: data.diapers.filter((d) => d.childId === id && inSession(d)).sort(byTime),
  }))
}
