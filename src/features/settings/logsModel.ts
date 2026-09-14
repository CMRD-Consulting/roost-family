import { TZDate } from '@date-fns/tz'
import { startOfDay, subDays, subYears } from 'date-fns'
import type { Tables } from '@/data/database.types'
import { toDiaper, toDose, toFeeding, toSleep, toSticker } from '@/data/mappers'
import type { EntryPatch, LogEntryRow, LogTable } from '@/data/settingsApi'
import type { StickerCategory } from '@/data/snapshot'
import { formatClock, formatDuration, householdDate } from '@/domain/time'
import type { DiaperEntry, DoseEntry, FeedingEntry, Medicine, SleepEntry, StickerEntry } from '@/domain/types'

export type LogTypeId = 'sleep' | 'feeding' | 'medicine' | 'sticker' | 'diaper'

/** The Logs section's type filter (spec §7.9), in the order of the main screen's log row. */
export const LOG_TYPES: readonly { id: LogTypeId; label: string; table: LogTable }[] = [
  { id: 'sleep', label: 'Sleep', table: 'sleep_entries' },
  { id: 'feeding', label: 'Feeding', table: 'feeding_entries' },
  { id: 'medicine', label: 'Medicine', table: 'dose_entries' },
  { id: 'sticker', label: 'Sticker', table: 'sticker_entries' },
  { id: 'diaper', label: 'Diaper', table: 'diaper_entries' },
]

/** Rows per `listEntries` page. */
export const LOGS_PAGE_SIZE = 50
export const VOID_REASON_MAX = 200
export const AMOUNT_MAX = 20

const FEEDING_TYPE: Record<FeedingEntry['type'], string> = { milk: 'Milk', meal: 'Meal', snack: 'Snack' }
const DIAPER_KIND: Record<DiaperEntry['kind'], string> = { wet: 'Wet', dirty: 'Dirty', both: 'Wet and dirty' }

type Entry =
  | { table: 'sleep_entries'; entry: SleepEntry }
  | { table: 'feeding_entries'; entry: FeedingEntry }
  | { table: 'dose_entries'; entry: DoseEntry }
  | { table: 'sticker_entries'; entry: StickerEntry }
  | { table: 'diaper_entries'; entry: DiaperEntry }

/** One row of the Logs list, described for an adult. */
export type LogItem = Entry & {
  id: string
  childId: string
  at: string
  loggedByName: string | null
  title: string
  detail: string | null
  /** Non-dose entries can be edited and deleted; doses can only be voided (spec §11.4). */
  editable: boolean
  voided: boolean
  voidReason: string | null
}

export interface LogItemContext {
  medicines: Medicine[]
  categories: StickerCategory[]
  timeZone: string
  now: Date
}

function toEntry(row: LogEntryRow, table: LogTable): Entry | null {
  const r = row.row
  switch (table) {
    case 'sleep_entries':
      return { table, entry: toSleep(r as Tables<'sleep_entries'>) }
    case 'feeding_entries':
      return { table, entry: toFeeding(r as Tables<'feeding_entries'>) }
    case 'dose_entries':
      return { table, entry: toDose(r as Tables<'dose_entries'>) }
    case 'sticker_entries':
      return { table, entry: toSticker(r as Tables<'sticker_entries'>) }
    case 'diaper_entries':
      return { table, entry: toDiaper(r as Tables<'diaper_entries'>) }
    default:
      return null
  }
}

function describe(e: Entry, ctx: LogItemContext): { title: string; detail: string | null } {
  switch (e.table) {
    case 'sleep_entries': {
      const title = e.entry.type === 'nap' ? 'Nap' : 'Night sleep'
      if (e.entry.endAt === null) return { title, detail: 'Still asleep' }
      const start = new Date(e.entry.startAt)
      const end = new Date(e.entry.endAt)
      const range = `${formatClock(start, ctx.timeZone)}–${formatClock(end, ctx.timeZone)}`
      return { title, detail: `${range} · ${formatDuration(end.getTime() - start.getTime())}` }
    }
    case 'feeding_entries': {
      const parts = [e.entry.amount, e.entry.note].filter((p): p is string => !!p)
      return { title: FEEDING_TYPE[e.entry.type], detail: parts.length > 0 ? parts.join(' · ') : null }
    }
    case 'dose_entries':
      return { title: ctx.medicines.find((m) => m.id === e.entry.medicineId)?.name ?? 'Medicine', detail: e.entry.note || null }
    case 'sticker_entries': {
      const category = ctx.categories.find((c) => c.id === e.entry.categoryId)
      return { title: category ? `${category.name} sticker` : 'Sticker', detail: null }
    }
    case 'diaper_entries':
      return { title: `${DIAPER_KIND[e.entry.kind]} diaper`, detail: null }
  }
}

/** A Logs row from a `listEntries` row, or null when the row can't be read (it is skipped, not fatal). */
export function toLogItem(row: LogEntryRow, table: LogTable, ctx: LogItemContext): LogItem | null {
  let e: Entry | null
  try {
    e = toEntry(row, table)
  } catch {
    return null
  }
  if (e === null) return null
  const dose = e.table === 'dose_entries' ? e.entry : null
  return {
    ...e,
    id: row.id,
    childId: row.childId,
    at: row.at,
    loggedByName: row.loggedByName,
    ...describe(e, ctx),
    editable: dose === null,
    voided: dose?.voidedAt != null,
    voidReason: dose?.voidReason ?? null,
  }
}

export function itemsOnDay(items: LogItem[], day: string, timeZone: string): LogItem[] {
  return items.filter((i) => householdDate(new Date(i.at), timeZone) === day)
}

/** The distinct household days among the loaded items, newest first (for "pick a date"). */
export function loadedDays(items: LogItem[], timeZone: string): string[] {
  return [...new Set(items.map((i) => householdDate(new Date(i.at), timeZone)))].sort().reverse()
}

function utcDay(day: string): Date {
  return new Date(`${day}T12:00:00Z`)
}

/** The household date `n` days before `day`. */
export function daysBefore(day: string, n: number): string {
  const d = utcDay(day)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === daysBefore(today, 1)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(utcDay(day))
}

/** A household date and wall-clock time ('HH:MM') as a UTC ISO timestamp. */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return new Date(new TZDate(y!, m! - 1, d!, h!, min!, timeZone).getTime()).toISOString()
}

function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const date = new Date(iso)
  const minutes = new TZDate(date.getTime(), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: householdDate(date, timeZone), time: `${pad(minutes.getHours())}:${pad(minutes.getMinutes())}` }
}

/** The edit panel for a non-dose entry: its time, and per type the end (sleep), type and amount (feeding) or
 *  kind (diaper). Unused fields keep harmless defaults. */
export interface EntryEditForm {
  date: string
  time: string
  /** Sleep only: whether the sleep has ended (an ongoing sleep is not given an end here). */
  hasEnd: boolean
  endDate: string
  endTime: string
  type: FeedingEntry['type']
  amount: string
  kind: DiaperEntry['kind']
}

export function entryEditFormFrom(item: LogItem, timeZone: string): EntryEditForm {
  const form: EntryEditForm = { date: '', time: '', hasEnd: false, endDate: '', endTime: '', type: 'milk', amount: '', kind: 'wet' }
  const start = zonedParts(item.at, timeZone)
  form.date = start.date
  form.time = start.time
  if (item.table === 'sleep_entries' && item.entry.endAt !== null) {
    const end = zonedParts(item.entry.endAt, timeZone)
    form.hasEnd = true
    form.endDate = end.date
    form.endTime = end.time
  }
  if (item.table === 'feeding_entries') {
    form.type = item.entry.type
    form.amount = item.entry.amount ?? ''
  }
  if (item.table === 'diaper_entries') form.kind = item.entry.kind
  return form
}

export type EntryEditErrors = Partial<Record<'time' | 'end' | 'amount', string>>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateEntryEdit(item: LogItem, form: EntryEditForm, timeZone: string, now: Date): EntryEditErrors {
  const errors: EntryEditErrors = {}
  if (!DATE_RE.test(form.date) || !TIME_RE.test(form.time)) {
    errors.time = 'Pick a date and time.'
  } else if (Date.parse(zonedIso(form.date, form.time, timeZone)) > now.getTime()) {
    errors.time = 'That time hasn’t happened yet.'
  }
  if (item.table === 'sleep_entries' && form.hasEnd) {
    if (!DATE_RE.test(form.endDate) || !TIME_RE.test(form.endTime)) {
      errors.end = 'Pick a date and time.'
    } else if (!errors.time) {
      const end = Date.parse(zonedIso(form.endDate, form.endTime, timeZone))
      if (end <= Date.parse(zonedIso(form.date, form.time, timeZone))) errors.end = 'The end must be after the start.'
      else if (end > now.getTime()) errors.end = 'That time hasn’t happened yet.'
    }
  }
  if (item.table === 'feeding_entries' && [...form.amount.trim()].length > AMOUNT_MAX) {
    errors.amount = `Amounts can be up to ${AMOUNT_MAX} characters.`
  }
  return errors
}

export function toEntryPatch(item: LogItem, form: EntryEditForm, timeZone: string): EntryPatch {
  const at = zonedIso(form.date, form.time, timeZone)
  switch (item.table) {
    case 'sleep_entries':
      return item.entry.endAt === null || !form.hasEnd
        ? { startAt: at }
        : { startAt: at, endAt: zonedIso(form.endDate, form.endTime, timeZone) }
    case 'feeding_entries':
      return { at, type: form.type, amount: form.amount.trim() || null }
    case 'diaper_entries':
      return { at, kind: form.kind }
    default:
      return { at }
  }
}

export function validateVoidReason(reason: string): string | null {
  const text = reason.trim()
  if (!text) return 'Say why this dose is being voided.'
  if ([...text].length > VOID_REASON_MAX) return `Reasons can be up to ${VOID_REASON_MAX} characters.`
  return null
}

/**
 * The bulk-delete cutoff (spec §11.2): the start of the household day two years ago, less one day. `subYears` clamps
 * Feb 29 to Feb 28 as Postgres does for `now() - interval '2 years'`, and the extra day keeps the cutoff safely before
 * the server's limit despite clock differences and time zones.
 */
export function retentionCutoff(now: Date, timeZone: string): string {
  const startOfToday = startOfDay(new TZDate(now.getTime(), timeZone))
  return new Date(subDays(subYears(startOfToday, 2), 1).getTime()).toISOString()
}
