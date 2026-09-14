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
 * household zone, as do floating times; DTSTART and DTEND each use their own TZID. DATE (all-day) values are always
 * midnight in the household zone. Nothing is registered in ical.js's global TimezoneService, so calendars parsed in
 * the same isolate cannot affect each other.
 *
 * Because ical.js compares zone-less wall-clock times as if they were UTC, EXDATE and RECURRENCE-ID values are
 * rewritten into their series' DTSTART form (UTC for zoned starts, wall clock in the start's zone otherwise) before
 * expansion.
 *
 * Cost: an Edge Function has about 2 s of CPU. Series without COUNT start expanding a few days before the window
 * (DTSTART moved forward by whole FREQ×INTERVAL periods, which keeps BYDAY/BYMONTHDAY/BYSETPOS anchors); COUNT series
 * must be walked from their start, but occurrences that clearly end before the window are skipped with arithmetic
 * alone. Walks are capped per series and per file; when a cap is hit the result is marked `partial`.
 */
import {
  cleanLocation,
  cleanTitle,
  compareEvents,
  isValidTimeZone,
  overlapsWindow,
  wallTimeAt,
  zonedWallTimeToUtc,
  type DayWindow,
  type SourceEvent,
  type WallTime,
} from './events.ts'

// ---- The slice of ical.js 2.x used here ----

export interface IcalTimezone {
  tzid: string
  /** Present only for zones hydrated from a VTIMEZONE in the parsed file. */
  component?: unknown
}

export interface IcalTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  readonly isDate: boolean
  zone: IcalTimezone
  toUnixTime(): number
  clone(): IcalTime
}

export interface IcalProperty {
  getParameter(name: string): unknown
  removeParameter(name: string): void
  getFirstValue(): unknown
  getValues(): unknown[]
  // deno-lint-ignore no-explicit-any
  setValues(values: any[]): void
  // deno-lint-ignore no-explicit-any
  setValue(value: any): void
}

export interface IcalComponent {
  readonly name: string
  getAllSubcomponents(name?: string): IcalComponent[]
  getFirstProperty(name?: string): IcalProperty | null
  getAllProperties(name?: string): IcalProperty[]
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
  modifiesFuture(): boolean
  // deno-lint-ignore no-explicit-any
  iterator(startTime?: any): IcalRecurExpansion
  /** `obj` is an event built by the same `ical` module (see the note on `IcalApi.Event`). */
  // deno-lint-ignore no-explicit-any
  relateException(obj: any): void
  // deno-lint-ignore no-explicit-any
  getOccurrenceDetails(occurrence: any): { startDate: IcalTime; endDate: IcalTime; item: IcalEvent }
}

export interface IcalApi {
  parse(input: string): unknown
  Component: new (jCal: unknown[]) => IcalComponent
  /**
   * Parameters that take the library's own objects are typed `any`: parameter types are checked contravariantly, so
   * its concrete `Component`/`Event`/`Time` classes cannot be narrowed to the structural slices here. Only objects
   * produced by the same `ical` module are ever passed in.
   */
  // deno-lint-ignore no-explicit-any
  Event: new (component: any, options?: { strictExceptions?: boolean }) => IcalEvent
  Time: {
    fromData(data: WallTime & { isDate: boolean }): IcalTime
    fromJSDate(date: Date, useUTC?: boolean): IcalTime
  }
}

// ---- Parser ----

export class IcsParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IcsParseError'
  }
}

export interface IcsDayResult {
  /** Occurrences overlapping the day, sorted all-day first then by start. */
  events: SourceEvent[]
  /** True when an expansion cap was hit, so some occurrences may be missing (worth logging). */
  partial: boolean
}

export interface IcsParser {
  parseIcsForDay(text: string, dayStartUtc: Date, dayEndUtc: Date, timeZone: string): IcsDayResult
  /** The calendar's `X-WR-CALNAME`, or null. Throws `IcsParseError` when `text` is not an iCalendar. */
  readIcsCalendarName(text: string): string | null
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** Real UTC offsets lie within ±14 h, so a wall-clock reading is within this of its instant. */
const ZONE_MARGIN_MS = 14 * HOUR_MS
/** Occurrence steps per series and per file (a step costs roughly 5–10 µs when skipped). */
const MAX_STEPS_PER_SERIES = 20_000
const MAX_STEPS_PER_FILE = 100_000

const FIXED_PERIOD_MS: Record<string, number> = {
  SECONDLY: 1000,
  MINUTELY: 60_000,
  HOURLY: HOUR_MS,
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
}

/** The wall-clock reading of `time` as if it were UTC (ms). */
function wallMs(time: IcalTime): number {
  return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function isIcalTime(value: unknown): value is IcalTime {
  return typeof value === 'object' && value !== null && 'isDate' in value && typeof (value as IcalTime).toUnixTime === 'function'
}

function isCancelled(component: IcalComponent): boolean {
  const status = component.getFirstPropertyValue('status')
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED'
}

function safeEnd(event: IcalEvent): IcalTime | null {
  try {
    return event.endDate ?? null
  } catch {
    return null
  }
}

/** Runs one VEVENT or series; one that ical.js cannot handle (e.g. an invalid RRULE) is skipped. */
function tryRun(run: () => void): void {
  try {
    run()
  } catch {
    // The rest of the calendar still shows.
  }
}

/**
 * A DTSTART moved forward by whole FREQ×INTERVAL periods to at most `targetWallMs`, or null when the rule must be
 * walked from its real start (COUNT, several RRULEs, unknown FREQ, or already near the window). Moving by whole
 * periods in wall-clock terms matches how ical.js steps, so BYxxx expansions and INTERVAL alignment are unchanged;
 * a month/year shift keeps the day of month and backs off to a period where that day exists.
 */
function skipAheadStart(master: IcalEvent, targetWallMs: number): IcalTime | null {
  const rules = master.component.getAllProperties('rrule')
  if (rules.length !== 1) return null
  const rule = rules[0]!.getFirstValue() as { freq?: unknown; interval?: unknown; count?: unknown } | null
  if (!rule || rule.count) return null
  const start = master.startDate
  const startWall = wallMs(start)
  if (targetWallMs <= startWall) return null
  const interval = typeof rule.interval === 'number' && rule.interval >= 1 ? Math.floor(rule.interval) : 1
  const freq = typeof rule.freq === 'string' ? rule.freq : ''

  let shiftedWall: number | null = null
  const fixed = FIXED_PERIOD_MS[freq]
  if (fixed) {
    const k = Math.floor((targetWallMs - startWall) / (fixed * interval))
    if (k > 0) shiftedWall = startWall + k * fixed * interval
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    const s = new Date(startWall)
    const t = new Date(targetWallMs)
    const step = (freq === 'MONTHLY' ? 1 : 12) * interval
    const months = (t.getUTCFullYear() - s.getUTCFullYear()) * 12 + (t.getUTCMonth() - s.getUTCMonth()) - 1
    for (let k = Math.floor(months / step); k > 0; k--) {
      const total = s.getUTCMonth() + k * step
      const year = s.getUTCFullYear() + Math.floor(total / 12)
      const month = total % 12
      if (s.getUTCDate() <= daysInMonth(year, month)) {
        shiftedWall = Date.UTC(year, month, s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds())
        break
      }
    }
  }
  if (shiftedWall === null) return null

  const d = new Date(shiftedWall)
  const shifted = start.clone()
  shifted.year = d.getUTCFullYear()
  shifted.month = d.getUTCMonth() + 1
  shifted.day = d.getUTCDate()
  shifted.hour = d.getUTCHours()
  shifted.minute = d.getUTCMinutes()
  shifted.second = d.getUTCSeconds()
  return shifted
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

  function parseIcsForDay(text: string, dayStartUtc: Date, dayEndUtc: Date, timeZone: string): IcsDayResult {
    const root = parseCalendar(text)
    const window: DayWindow = { dayStartUtc, dayEndUtc }
    const dayStartMs = dayStartUtc.getTime()
    const dayEndMs = dayEndUtc.getTime()
    const results: SourceEvent[] = []
    let fileSteps = MAX_STEPS_PER_FILE
    let partial = false

    /** The zone for a property's floating wall-clock value: its TZID when that is an IANA name. */
    function tzidZone(prop: IcalProperty | null): string {
      const tzid = prop?.getParameter('tzid')
      return typeof tzid === 'string' && isValidTimeZone(tzid) ? tzid : timeZone
    }

    function isAbsolute(time: IcalTime): boolean {
      return !!time.zone && (time.zone.tzid === 'UTC' || !!time.zone.component)
    }

    function toUtcMs(time: IcalTime, floatingZone: string): number {
      if (time.isDate) {
        return zonedWallTimeToUtc({ year: time.year, month: time.month, day: time.day, hour: 0, minute: 0, second: 0 }, timeZone).getTime()
      }
      if (isAbsolute(time)) return time.toUnixTime() * 1000
      return zonedWallTimeToUtc(
        { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
        floatingZone,
      ).getTime()
    }

    function push(item: IcalEvent, start: IcalTime, startMs: number, endMs: number): void {
      if (isCancelled(item.component) || Number.isNaN(startMs)) return
      if (!(endMs > startMs)) {
        // No usable end: an all-day event lasts one day, a timed one is an instant (RFC 5545 §3.6.1).
        endMs = start.isDate
          ? zonedWallTimeToUtc({ year: start.year, month: start.month, day: start.day + 1, hour: 0, minute: 0, second: 0 }, timeZone).getTime()
          : startMs
      }
      if (!overlapsWindow(startMs, endMs, window)) return
      results.push({
        title: cleanTitle(item.summary),
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        allDay: start.isDate,
        location: cleanLocation(item.location),
      })
    }

    /** Emits an event at its own DTSTART/DTEND, each read in its own zone. */
    function emitOwn(item: IcalEvent): void {
      const start = item.startDate
      const startMs = toUtcMs(start, tzidZone(item.component.getFirstProperty('dtstart')))
      const dtend = item.component.getFirstPropertyValue('dtend')
      let endMs: number
      if (isIcalTime(dtend)) {
        endMs = toUtcMs(dtend, tzidZone(item.component.getFirstProperty('dtend')))
      } else {
        const end = safeEnd(item)
        endMs = end ? toUtcMs(end, tzidZone(item.component.getFirstProperty('dtstart'))) : Number.NaN
      }
      push(item, start, startMs, endMs)
    }

    function expandSeries(master: IcalEvent, overrides: IcalEvent[]): void {
      if (isCancelled(master.component)) return
      const start = master.startDate
      const startZone = tzidZone(master.component.getFirstProperty('dtstart'))
      const absolute = isAbsolute(start)
      const baseStartMs = toUtcMs(start, startZone)
      const dtend = master.component.getFirstPropertyValue('dtend')
      // DTEND-based instances last exactly as long as the first one (RFC 5545 §3.8.5.3), even across zones.
      const exactDurationMs =
        isIcalTime(dtend) && !start.isDate ? Math.max(0, toUtcMs(dtend, tzidZone(master.component.getFirstProperty('dtend'))) - baseStartMs) : null
      const masterEnd = safeEnd(master)
      const skipDurationMs = Math.max(masterEnd ? wallMs(masterEnd) - wallMs(start) : 0, exactDurationMs ?? 0, 0)

      /** Rewrites a DATE-TIME into DTSTART's form: UTC for zoned starts, wall clock in the start's zone otherwise. */
      function inStartForm(time: IcalTime, valueZone: string): IcalTime | null {
        if (time.isDate) return null
        if (absolute ? isAbsolute(time) : !isAbsolute(time) && valueZone === startZone) return null
        const ms = toUtcMs(time, valueZone)
        return absolute ? ical.Time.fromJSDate(new Date(ms), true) : ical.Time.fromData({ ...wallTimeAt(ms, startZone), isDate: false })
      }

      for (const prop of master.component.getAllProperties('exdate')) {
        const zone = tzidZone(prop)
        const values = prop.getValues()
        const rewritten = values.map((v) => (isIcalTime(v) ? inStartForm(v, zone) : null))
        if (rewritten.every((v) => v === null)) continue
        prop.removeParameter('tzid')
        prop.setValues(values.map((v, i) => rewritten[i] ?? v))
      }

      for (const override of overrides) {
        const prop = override.component.getFirstProperty('recurrence-id')
        const value = prop?.getFirstValue()
        if (prop && isIcalTime(value)) {
          const rewritten = inStartForm(value, tzidZone(prop))
          if (rewritten) {
            prop.removeParameter('tzid')
            prop.setValue(rewritten)
          }
        }
        try {
          master.relateException(override)
        } catch {
          // An override with an unusable RECURRENCE-ID is still shown by the pass below if it falls today.
        }
      }

      const earliestUsefulStart = dayStartMs - ZONE_MARGIN_MS - skipDurationMs - 2 * DAY_MS
      const iterator = master.iterator(skipAheadStart(master, earliestUsefulStart) ?? undefined)
      const handled = new Set<IcalEvent>()
      for (let steps = 0; ; steps++, fileSteps--) {
        if (steps >= MAX_STEPS_PER_SERIES || fileSteps <= 0) {
          partial = true
          break
        }
        const occurrence = iterator.next()
        if (!occurrence) break
        const approx = wallMs(occurrence)
        if (approx - ZONE_MARGIN_MS >= dayEndMs) break
        // Clearly over before today; an override of this instance is still considered by the pass below.
        if (approx + skipDurationMs + ZONE_MARGIN_MS <= dayStartMs) continue

        const details = master.getOccurrenceDetails(occurrence)
        const item = details.item
        if (item !== master) {
          handled.add(item)
          if (item.modifiesFuture()) {
            const zone = tzidZone(item.component.getFirstProperty('dtstart'))
            push(item, details.startDate, toUtcMs(details.startDate, zone), toUtcMs(details.endDate, zone))
          } else {
            emitOwn(item)
          }
          continue
        }
        const occurrenceStartMs = toUtcMs(occurrence, startZone)
        const occurrenceEndMs =
          exactDurationMs !== null ? occurrenceStartMs + exactDurationMs : details.endDate ? toUtcMs(details.endDate, startZone) : Number.NaN
        push(master, occurrence, occurrenceStartMs, occurrenceEndMs)
      }

      // Overrides not reached above (moved in from a later or skipped instance, past the end of the series, or with a
      // RECURRENCE-ID the rule never generates) still show if they fall today.
      for (const override of overrides) {
        if (!handled.has(override)) tryRun(() => emitOwn(override))
      }
    }

    // Group VEVENTs by UID: masters (no RECURRENCE-ID) and overridden instances.
    const groups = new Map<string, { masters: IcalEvent[]; overrides: IcalEvent[] }>()
    let anonymous = 0
    for (const component of root.getAllSubcomponents('vevent')) {
      try {
        const event = new ical.Event(component, { strictExceptions: false })
        if (!event.startDate) continue
        const uid = component.getFirstPropertyValue('uid')
        const key = typeof uid === 'string' && uid ? uid : ` anonymous-${anonymous++}`
        const group = groups.get(key) ?? { masters: [], overrides: [] }
        if (component.getFirstProperty('recurrence-id')) group.overrides.push(event)
        else group.masters.push(event)
        groups.set(key, group)
      } catch {
        // Malformed VEVENT (e.g. an unparseable DTSTART): skip it.
      }
    }

    for (const { masters, overrides } of groups.values()) {
      const series = masters.filter((m) => m.isRecurring())
      const singles = masters.filter((m) => !m.isRecurring())
      const [primary, ...otherSeries] = series

      if (primary) {
        tryRun(() => expandSeries(primary, overrides))
      } else {
        // No series to attach overrides to: show them as they are, in place of a single event they replace.
        const replaced = new Set<number>()
        for (const override of overrides) {
          tryRun(() => {
            replaced.add(toUtcMs(override.recurrenceId, tzidZone(override.component.getFirstProperty('recurrence-id'))))
            emitOwn(override)
          })
        }
        for (const single of singles.splice(0)) {
          tryRun(() => {
            if (!replaced.has(toUtcMs(single.startDate, tzidZone(single.component.getFirstProperty('dtstart'))))) emitOwn(single)
          })
        }
      }
      for (const single of singles) tryRun(() => emitOwn(single))
      for (const other of otherSeries) tryRun(() => expandSeries(other, []))
    }

    return { events: results.sort(compareEvents), partial }
  }

  function readIcsCalendarName(text: string): string | null {
    const root = parseCalendar(text)
    const name = root.getFirstPropertyValue('x-wr-calname')
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }

  return { parseIcsForDay, readIcsCalendarName }
}
