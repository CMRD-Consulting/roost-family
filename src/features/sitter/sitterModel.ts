import { currentStepIndex, routineForDay } from '@/domain/routines'
import { sitterSummary } from '@/domain/sitterSummary'
import { formatClock, formatDuration, householdDate, householdWeekday, minutesOfDay } from '@/domain/time'
import type { DiaperEntry, DoseEntry, FeedingEntry } from '@/domain/types'
import type { Attribution } from '@/data/logCommands'
import type { HouseholdSnapshot, SitterSession } from '@/data/snapshot'

const H = 3_600_000
/** A session's summary is offered for this long after it ended (matches the snapshot's `recentSitterSession`). */
const PENDING_SUMMARY_MS = 12 * H

// ---------------------------------------------------------------------------------------------------------------
// Attribution

/** "Jess (sitter)", or "Sitter" when no name was given (spec §6.5, §7.6). */
export function sitterLabel(session: Pick<SitterSession, 'sitterName'>): string {
  const name = session.sitterName?.trim()
  return name ? `${name} (sitter)` : 'Sitter'
}

/** The attribution fields every entry logged during Sitter Mode carries. */
export function sitterAttribution(session: SitterSession): Pick<Attribution, 'sitterSessionId' | 'loggedByName'> {
  return { sitterSessionId: session.id, loggedByName: sitterLabel(session) }
}

// ---------------------------------------------------------------------------------------------------------------
// Care Info

export interface CareInfoSection {
  title: string
  body: string
}

export interface CareInfoModel {
  sections: CareInfoSection[]
}

const clean = (text: string | null | undefined): string => text?.trim() ?? ''
const lines = (...parts: string[]): string => parts.filter((p) => p !== '').join('\n')

/** The Care Info panel shown in place of the calendar during Sitter Mode (spec §7.6). Empty sections are left out. */
export function careInfoModel(s: HouseholdSnapshot, now: Date): CareInfoModel {
  const tz = s.household.timeZone
  const today = householdDate(now, tz)
  const info = s.household.sitterInfo ?? {}
  const children = [...s.children].sort((a, b) => a.sortOrder - b.sortOrder)

  const routineLines = children.map((child) => {
    const override = s.routineOverrides.find((o) => o.childId === child.id && o.day === today)
    const routine = routineForDay(s.routines, child.id, householdWeekday(now, tz), override?.routineId ?? null)
    if (!routine) return `${child.name}: No routine today`
    const completed =
      s.routineProgress.find((p) => p.childId === child.id && p.routineId === routine.id && p.day === today)?.completed ?? []
    const current = currentStepIndex(routine, completed, minutesOfDay(now, tz))
    const step = current === null ? undefined : routine.steps[current]
    return `${child.name}: ${step ? step.label : 'Routine done for today'}`
  })

  const bedtime = clean(info.bedtime)
  const foodLines = children.flatMap((child) => {
    const allergies = clean(child.allergies)
    const rules = clean(child.foodRules)
    return [allergies && `${child.name} allergies: ${allergies}`, rules && `${child.name}: ${rules}`]
  })

  const sections: CareInfoSection[] = [
    { title: "Today's routine", body: lines(...routineLines) },
    { title: 'Naps & bedtime', body: lines(clean(info.napInstructions), bedtime && `Bedtime: ${bedtime}`) },
    { title: 'Food & allergies', body: lines(...foodLines, clean(info.foodRules)) },
    { title: 'Emergency contacts', body: clean(info.emergencyContacts) },
    { title: 'Pediatrician', body: clean(info.pediatrician) },
    { title: 'Address', body: clean(info.address) },
    { title: 'Where things are', body: clean(info.whereThings) },
  ]
  return { sections: sections.filter((section) => section.body !== '') }
}

// ---------------------------------------------------------------------------------------------------------------
// While You Were Out

export type SummaryIcon = 'sleep' | 'feeding' | 'medicine' | 'sticker' | 'diaper'
export type SummaryFlag = 'warningConfirmed' | 'voided' | 'offline'

export interface SummaryLineFlag {
  kind: SummaryFlag
  /** How the flag is described under the line, e.g. "Voided: Logged twice". */
  text: string
}

export interface SummaryLine {
  time: string
  icon: SummaryIcon
  text: string
  /** Present only when the line has flags (doses), most important first. */
  flags?: SummaryLineFlag[]
}

export interface SummaryChild {
  childId: string
  name: string
  color: string
  lines: SummaryLine[]
}

export interface SummaryModel {
  title: 'While you were out'
  /** The sitter's name, or "Sitter". */
  sitterName: string
  rangeLabel: string
  children: SummaryChild[]
}

/** A dose's flags: voided (with the adult's reason), given despite a timing warning, logged offline. */
function doseFlags(dose: DoseEntry): SummaryLineFlag[] {
  const flags: SummaryLineFlag[] = []
  if (dose.voidedAt !== null) {
    const reason = clean(dose.voidReason)
    flags.push({ kind: 'voided', text: reason ? `Voided: ${reason}` : 'Voided' })
  }
  if (dose.warningsConfirmed.length > 0) flags.push({ kind: 'warningConfirmed', text: 'Given despite a timing warning' })
  if (dose.loggedOffline) flags.push({ kind: 'offline', text: 'Logged offline' })
  return flags
}

const FEEDING_TYPE: Record<FeedingEntry['type'], string> = { milk: 'Milk', meal: 'Meal', snack: 'Snack' }
const DIAPER_KIND: Record<DiaperEntry['kind'], string> = { wet: 'Wet', dirty: 'Dirty', both: 'Wet and dirty' }

/** "1:05–2:20 PM" when both ends share AM/PM, else "11:30 AM–12:40 PM". */
function clockRange(start: Date, end: Date, timeZone: string): string {
  const a = formatClock(start, timeZone)
  const b = formatClock(end, timeZone)
  const suffix = (clock: string) => clock.slice(clock.lastIndexOf(' ') + 1)
  const sameHalf = suffix(a) === suffix(b) && a.includes(' ')
  return `${sameHalf ? a.slice(0, a.lastIndexOf(' ')) : a}–${b}`
}

/** The full-screen summary of what was logged during a sitter session (spec §7.6), per child, oldest first. */
export function summaryModel(s: HouseholdSnapshot, session: SitterSession, now: Date): SummaryModel {
  const tz = s.household.timeZone
  const clock = (iso: string) => formatClock(new Date(iso), tz)
  const children = [...s.children].sort((a, b) => a.sortOrder - b.sortOrder)
  const medicineName = new Map(s.medicines.map((m) => [m.id, m.name]))
  const categoryName = new Map(s.stickerCategories.map((c) => [c.id, c.name]))

  const grouped = sitterSummary(
    { id: session.id, startAt: session.startedAt, endAt: session.endedAt },
    children,
    { sleeps: s.sleeps, feedings: s.feedings, doses: s.doses, stickers: s.stickers, diapers: s.diapers },
    now,
  )
  const byChild = new Map(grouped.map((g) => [g.childId, g]))

  const summaryChildren = children.map((child): SummaryChild => {
    const data = byChild.get(child.id)
    const timed: { at: number; line: SummaryLine }[] = []
    const add = (at: string, line: SummaryLine) => timed.push({ at: Date.parse(at), line })

    for (const sleep of data?.sleeps ?? []) {
      const label = sleep.type === 'nap' ? 'Nap' : 'Night sleep'
      const text =
        sleep.endAt === null
          ? `${label} from ${clock(sleep.startAt)}`
          : `${label} ${clockRange(new Date(sleep.startAt), new Date(sleep.endAt), tz)} (${formatDuration(Date.parse(sleep.endAt) - Date.parse(sleep.startAt))})`
      add(sleep.startAt, { time: clock(sleep.startAt), icon: 'sleep', text })
    }
    for (const feeding of data?.feedings ?? []) {
      const text = [FEEDING_TYPE[feeding.type], clean(feeding.amount), clean(feeding.note)].filter(Boolean).join(' · ')
      add(feeding.at, { time: clock(feeding.at), icon: 'feeding', text })
    }
    for (const dose of data?.doses ?? []) {
      const text = [medicineName.get(dose.medicineId) ?? 'Medicine', clean(dose.note)].filter(Boolean).join(' · ')
      const flags = doseFlags(dose)
      add(dose.at, { time: clock(dose.at), icon: 'medicine', text, ...(flags.length > 0 ? { flags } : {}) })
    }
    for (const sticker of data?.stickers ?? []) {
      const name = categoryName.get(sticker.categoryId)
      add(sticker.at, { time: clock(sticker.at), icon: 'sticker', text: name ? `Sticker: ${name}` : 'Sticker' })
    }
    for (const diaper of data?.diapers ?? []) {
      add(diaper.at, { time: clock(diaper.at), icon: 'diaper', text: `Diaper: ${DIAPER_KIND[diaper.kind]}` })
    }

    return {
      childId: child.id,
      name: child.name,
      color: child.color,
      lines: timed.sort((a, b) => a.at - b.at).map((t) => t.line),
    }
  })

  const end = session.endedAt ? formatClock(new Date(session.endedAt), tz) : 'now'
  return {
    title: 'While you were out',
    sitterName: clean(session.sitterName) || 'Sitter',
    rangeLabel: `${clock(session.startedAt)} – ${end}`,
    children: summaryChildren,
  }
}

/**
 * The recently ended session whose summary no display has shown yet, or null. A device-cached snapshot from
 * before these fields existed may have them undefined: that counts as nothing pending.
 */
export function pendingSummary(s: HouseholdSnapshot, now: Date): SitterSession | null {
  const recent = s.recentSitterSession ?? null
  if (recent === null || !recent.endedAt || (recent.summaryShownAt ?? null) !== null) return null
  if (now.getTime() - Date.parse(recent.endedAt) > PENDING_SUMMARY_MS) return null
  return recent
}

/** "Sitter session with Jess ended at 9:10 PM" for the banner on displays that didn't end it. */
export function summaryBannerLabel(session: SitterSession, timeZone: string): string {
  const name = clean(session.sitterName)
  const ended = session.endedAt ? ` ended at ${formatClock(new Date(session.endedAt), timeZone)}` : ' ended'
  return `Sitter session${name ? ` with ${name}` : ''}${ended}`
}
