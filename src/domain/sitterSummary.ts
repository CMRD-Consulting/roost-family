import type { DiaperEntry, DoseEntry, FeedingEntry, IsoTimestamp, SleepEntry, StickerEntry } from './types'

export interface SessionRange {
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

export function sitterSummary(
  session: SessionRange,
  children: { id: string }[],
  data: SummaryData,
  now: Date,
): ChildSummary[] {
  const start = Date.parse(session.startAt)
  const end = session.endAt ? Date.parse(session.endAt) : now.getTime()
  const inRange = (at: string) => {
    const t = Date.parse(at)
    return t >= start && t <= end
  }
  const byTime = <T extends { at: string }>(a: T, b: T) => Date.parse(a.at) - Date.parse(b.at)

  return children.map(({ id }) => ({
    childId: id,
    sleeps: data.sleeps
      .filter((s) => s.childId === id && Date.parse(s.startAt) <= end && (s.endAt ? Date.parse(s.endAt) : end) >= start)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    feedings: data.feedings.filter((f) => f.childId === id && inRange(f.at)).sort(byTime),
    doses: data.doses.filter((d) => d.childId === id && inRange(d.at)).sort(byTime),
    stickers: data.stickers.filter((s) => s.childId === id && inRange(s.at)).sort(byTime),
    diapers: data.diapers.filter((d) => d.childId === id && inRange(d.at)).sort(byTime),
  }))
}
