/**
 * ICS subscription parsing for the household day (spec §5.5, §7.2): recurrence expansion (RRULE, RDATE, EXDATE,
 * RECURRENCE-ID overrides), all-day DATE values in the household zone, cancellations, and tolerance of broken
 * VEVENTs. Returns only the minimal `SourceEvent` fields; descriptions, attendees, URLs and organizers are never read.
 *
 * How `ical.js` is supplied: this module never imports it. Vitest resolves npm packages from node_modules while
 * the Edge Functions (Deno) need an `npm:` specifier, and no single import specifier works in both. So the parser
 * is built by `createIcsParser(ical)` from the module passed in:
 *   - Edge Functions: `import { ical } from '../_shared/icalModule.ts'` (which does `import ICAL from 'npm:ical.js@…'`
 *     and checks it against `IcalApi` under `deno check`), then `createIcsParser(ical)`.
 *   - Vitest: `import ICAL from 'ical.js'` (a devDependency pinned to the same version), then `createIcsParser(ICAL)`.
 * `IcalApi` below is the small structural slice of ical.js 2.x this module uses.
 *
 * Time zones: a TZID backed by a VTIMEZONE in the file is resolved by ical.js from that definition (so Outlook's
 * non-IANA names work). A TZID without a VTIMEZONE falls back to `Intl` when it is an IANA name, otherwise to the
 * household zone, as do floating times. DATE (all-day) values are always midnight in the household zone. Nothing is
 * registered in ical.js's global TimezoneService, so calendars parsed in the same isolate cannot affect each other.
 */
import {
  cleanLocation,
  cleanTitle,
  compareEvents,
  isValidTimeZone,
  overlapsWindow,
  zonedWallTimeToUtc,
  type DayWindow,
  type SourceEvent,
} from './events.ts'

// ---- The slice of ical.js 2.x used here ----

export interface IcalTimezone {
  tzid: string
  /** Present only for zones hydrated from a VTIMEZONE in the parsed file. */
  component?: unknown
}

export interface IcalTime {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly isDate: boolean
  zone: IcalTimezone
  toUnixTime(): number
}

export interface IcalProperty {
  getParameter(name: string): unknown
}

export interface IcalComponent {
  readonly name: string
  getAllSubcomponents(name?: string): IcalComponent[]
  getFirstProperty(name?: string): IcalProperty | null
  getFirstPropertyValue(name?: string): unknown
}

export interface IcalRecurExpansion {
  next(): IcalTime | undefined
}

export interface IcalEvent {
  readonly component: IcalComponent
  readonly summary: string
  readonly location: string
  readonly startDate: IcalTime
  readonly endDate: IcalTime
  readonly recurrenceId: IcalTime
  isRecurring(): boolean
  iterator(): IcalRecurExpansion
  /** `obj` is an event built by the same `ical` module (see the note on `IcalApi.Event`). */
  // deno-lint-ignore no-explicit-any
  relateException(obj: any): void
  getOccurrenceDetails(occurrence: IcalTime): { startDate: IcalTime; endDate: IcalTime; item: IcalEvent }
}

export interface IcalApi {
  parse(input: string): unknown
  Component: new (jCal: unknown[]) => IcalComponent
  /**
   * Parameters that take the library's own objects are typed `any`: parameter types are checked contravariantly, so
   * its concrete `Component`/`Event` classes cannot be narrowed to the structural slices here. Only objects produced
   * by the same `ical` module are ever passed in.
   */
  // deno-lint-ignore no-explicit-any
  Event: new (component: any, options?: { strictExceptions?: boolean }) => IcalEvent
}

// ---- Parser ----

export class IcsParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IcsParseError'
  }
}

/**
 * Bounds on recurrence expansion, which walks each series from its first occurrence (about 50 µs per step): a
 * daily series from 1970 is ~21k steps. Series beyond the per-series cap, or past the per-file budget, are skipped.
 */
const MAX_OCCURRENCES_PER_SERIES = 25_000
const MAX_OCCURRENCES_PER_FILE = 100_000
const DAY_MS = 86_400_000

export interface IcsParser {
  /** Occurrences overlapping [dayStartUtc, dayEndUtc), sorted all-day first then by start. */
  parseIcsForDay(text: string, dayStartUtc: Date, dayEndUtc: Date, timeZone: string): SourceEvent[]
  /** The calendar's `X-WR-CALNAME`, or null. Throws `IcsParseError` when `text` is not an iCalendar. */
  readIcsCalendarName(text: string): string | null
}

export function createIcsParser(ical: IcalApi): IcsParser {
  function tryParseComponent(text: string): IcalComponent | null {
    try {
      const jCal = ical.parse(text)
      // A file with several top-level components parses to an array of jCal arrays.
      const first = Array.isArray(jCal) && Array.isArray(jCal[0]) ? jCal[0] : jCal
      if (!Array.isArray(first)) return null
      const root = new ical.Component(first)
      return root.name === 'vcalendar' ? root : null
    } catch {
      return null
    }
  }

  /**
   * Parses the calendar. When ical.js rejects the whole file (a single malformed line anywhere throws), the file is
   * rebuilt from the VTIMEZONE and VEVENT blocks that parse on their own, so one bad event cannot hide the rest.
   */
  function parseCalendar(text: string): IcalComponent {
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcsParseError('not an iCalendar file')
    const whole = tryParseComponent(text)
    if (whole) return whole

    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
    const header: string[] = []
    const blocks: Array<{ kind: string; lines: string[] }> = []
    let current: { kind: string; lines: string[] } | null = null
    let depth = 0
    for (const line of lines) {
      const begin = /^BEGIN:([\w-]+)/i.exec(line)?.[1]?.toLowerCase()
      const end = /^END:([\w-]+)/i.exec(line)?.[1]?.toLowerCase()
      if (!current) {
        if (begin === 'vcalendar' || end === 'vcalendar') continue
        if (begin) {
          current = { kind: begin, lines: [line] }
          depth = 1
        } else if (/^[A-Za-z][\w-]*[;:]/.test(line)) {
          header.push(line)
        }
        continue
      }
      current.lines.push(line)
      if (begin) depth++
      if (end) depth--
      if (depth === 0) {
        blocks.push(current)
        current = null
      }
    }

    const wrap = (body: string[]) => ['BEGIN:VCALENDAR', ...header, ...body, 'END:VCALENDAR', ''].join('\r\n')
    const zones = blocks.filter((b) => b.kind === 'vtimezone' && tryParseComponent(wrap(b.lines))).flatMap((b) => b.lines)
    const events = blocks.filter((b) => b.kind === 'vevent' && tryParseComponent(wrap([...zones, ...b.lines]))).flatMap((b) => b.lines)
    const rebuilt = tryParseComponent(wrap([...zones, ...events]))
    if (!rebuilt) throw new IcsParseError('could not parse iCalendar file')
    return rebuilt
  }

  function isCancelled(component: IcalComponent): boolean {
    const status = component.getFirstPropertyValue('status')
    return typeof status === 'string' && status.toUpperCase() === 'CANCELLED'
  }

  function parseIcsForDay(text: string, dayStartUtc: Date, dayEndUtc: Date, timeZone: string): SourceEvent[] {
    const root = parseCalendar(text)
    const window: DayWindow = { dayStartUtc, dayEndUtc }
    const dayEndMs = dayEndUtc.getTime()
    const results: SourceEvent[] = []
    let fileBudget = MAX_OCCURRENCES_PER_FILE

    /** The zone for floating wall-clock times of `item`: its DTSTART TZID when that is an IANA name. */
    function fallbackZone(item: IcalEvent): string {
      const tzid = item.component.getFirstProperty('dtstart')?.getParameter('tzid')
      return typeof tzid === 'string' && isValidTimeZone(tzid) ? tzid : timeZone
    }

    function toUtcMs(time: IcalTime, floatingZone: string): number {
      if (time.isDate) {
        return zonedWallTimeToUtc({ year: time.year, month: time.month, day: time.day, hour: 0, minute: 0, second: 0 }, timeZone).getTime()
      }
      if (time.zone && (time.zone.tzid === 'UTC' || time.zone.component)) return time.toUnixTime() * 1000
      return zonedWallTimeToUtc(
        { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
        floatingZone,
      ).getTime()
    }

    function emit(start: IcalTime, end: IcalTime | null, item: IcalEvent): void {
      if (isCancelled(item.component)) return
      const zone = fallbackZone(item)
      const startMs = toUtcMs(start, zone)
      let endMs = end ? toUtcMs(end, zone) : Number.NaN
      if (!(endMs > startMs)) {
        // No usable end: an all-day event lasts one day, a timed one is an instant (RFC 5545 §3.6.1).
        endMs = start.isDate
          ? zonedWallTimeToUtc({ year: start.year, month: start.month, day: start.day + 1, hour: 0, minute: 0, second: 0 }, timeZone).getTime()
          : startMs
      }
      if (Number.isNaN(startMs) || !overlapsWindow(startMs, endMs, window)) return
      results.push({
        title: cleanTitle(item.summary),
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        allDay: start.isDate,
        location: cleanLocation(item.location),
      })
    }

    function safeEnd(event: IcalEvent): IcalTime | null {
      try {
        return event.endDate ?? null
      } catch {
        return null
      }
    }

    // Group VEVENTs by UID: the master (no RECURRENCE-ID) plus its overridden instances.
    const groups = new Map<string, { masters: IcalEvent[]; exceptions: IcalEvent[] }>()
    let anonymous = 0
    for (const component of root.getAllSubcomponents('vevent')) {
      try {
        const event = new ical.Event(component, { strictExceptions: false })
        if (!event.startDate) continue
        const uid = component.getFirstPropertyValue('uid')
        const key = typeof uid === 'string' && uid ? uid : ` anonymous-${anonymous++}`
        const group = groups.get(key) ?? { masters: [], exceptions: [] }
        if (component.getFirstProperty('recurrence-id')) group.exceptions.push(event)
        else group.masters.push(event)
        groups.set(key, group)
      } catch {
        // Malformed VEVENT (e.g. an unparseable DTSTART): skip it.
      }
    }

    for (const { masters, exceptions } of groups.values()) {
      const master = masters[0]
      if (!master) {
        // Overrides whose series is missing from the feed: show them as they are.
        for (const exception of exceptions) tryEmit(() => emit(exception.startDate, safeEnd(exception), exception))
        continue
      }
      tryEmit(() => {
        if (isCancelled(master.component)) return
        if (!master.isRecurring()) {
          emit(master.startDate, safeEnd(master), master)
          return
        }
        for (const exception of exceptions) {
          try {
            master.relateException(exception)
          } catch {
            // An override with an unusable RECURRENCE-ID is ignored.
          }
        }
        const zone = fallbackZone(master)
        const iterator = master.iterator()
        const shown = new Set<IcalEvent>()
        for (let i = 0; i < MAX_OCCURRENCES_PER_SERIES && fileBudget > 0; i++, fileBudget--) {
          const occurrence = iterator.next()
          if (!occurrence) break
          // Stop once original occurrences start after today; an override pulled into today is handled below.
          // A generous one-day margin keeps overrides and floating-zone rounding safe.
          if (toUtcMs(occurrence, zone) >= dayEndMs + DAY_MS) break
          const details = master.getOccurrenceDetails(occurrence)
          if (details.item !== master) shown.add(details.item)
          emit(details.startDate, details.endDate ?? null, details.item)
        }
        // Overrides of later occurrences that were moved into today.
        for (const exception of exceptions) {
          if (shown.has(exception)) continue
          if (toUtcMs(exception.recurrenceId, zone) < dayEndMs + DAY_MS) continue
          emit(exception.startDate, safeEnd(exception), exception)
        }
      })
    }

    return results.sort(compareEvents)
  }

  function readIcsCalendarName(text: string): string | null {
    const root = parseCalendar(text)
    const name = root.getFirstPropertyValue('x-wr-calname')
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }

  return { parseIcsForDay, readIcsCalendarName }
}

function tryEmit(run: () => void): void {
  try {
    run()
  } catch {
    // A series that ical.js cannot expand (e.g. an invalid RRULE) is skipped; the rest of the calendar still shows.
  }
}
