/**
 * Streaming pre-filter for ICS subscriptions (spec §5.5): keeps a real personal calendar usable without ever holding
 * it in memory.
 *
 * A Google or iCloud secret-address export is the whole calendar — years of history, commonly a few MB (the one that
 * prompted this was 1.85 MB uncompressed for 2,245 events back to 1970, of which exactly one started today). Roost
 * only ever shows today in the household's zone, so the body is read as a stream and all but a handful of blocks is
 * thrown away as it arrives: retained memory stays in the tens of KB whatever the file's size.
 *
 * What survives: the VCALENDAR header properties, every VTIMEZONE block, and the VEVENT blocks that could matter
 * today — anything with RRULE or RDATE (a series may have an instance today), anything with RECURRENCE-ID (the
 * parser needs overrides), and anything whose DTSTART/DTEND date portion falls within ±2 days of the household day
 * (of the first and last day, when a display asks for today and tomorrow: `lastDay`).
 * The comparison is textual on YYYYMMDD and deliberately generous: zones, all-day values and DURATION only have to
 * be *nearly* right here, because `parseIcsForDay` and `mergeDayEvents` still decide what is really shown. Anything
 * unparseable is kept, never dropped. VTODO, VJOURNAL and VFREEBUSY are dropped: the parser never reads them.
 *
 * Budgets (both count *decoded* bytes — the runtime's `fetch` has already un-gzipped the body, which is why a
 * 342 KB transfer read as 1.85 MB against the old 1 MB cap):
 *   - `ICS_MAX_DOWNLOAD_BYTES` (20 MB) — bytes pulled off the network before the read stops.
 *   - `ICS_MAX_RETAINED_BYTES` (2 MB) — the reduced text. Hitting this means a genuinely enormous single day.
 * Either one stops the read and marks the result `partial`; neither fails. A single logical line over
 * `ICS_MAX_LINE_BYTES` (64 KB — a pathological DESCRIPTION) has that one property dropped, not the event.
 *
 * Plain TypeScript with web streams only, so Vitest and the Edge Functions share it.
 */
import { wallTimeAt, type DayWindow } from './events.ts'

/** Bytes read off the network before the read stops. Real exports are single-digit MB. */
export const ICS_MAX_DOWNLOAD_BYTES = 20_000_000
/** The reduced text handed to the parser. Tens of KB in practice. */
export const ICS_MAX_RETAINED_BYTES = 2_000_000
/** One unfolded property line; beyond this the property is dropped (the event is still kept). */
export const ICS_MAX_LINE_BYTES = 64_000
/** Days of slack either side of the household day, so zones and all-day values stay safe. */
export const ICS_PREFILTER_SLACK_DAYS = 2
/** Without a BEGIN:VCALENDAR by here it is not a calendar; stop rather than download a whole web page. */
const NOT_A_CALENDAR_AFTER_BYTES = 64_000

export interface IcsPrefilterCounts {
  /** Decoded bytes pulled from the body. */
  bytesRead: number
  /** VEVENT blocks the file contained (up to where the read stopped). */
  eventsSeen: number
  /** VEVENT blocks the parser will see. */
  eventsKept: number
  /** Size of the reduced text. */
  retainedBytes: number
  /** Property lines dropped for being absurdly long. */
  linesDropped: number
  downloadLimitHit: boolean
  retainedLimitHit: boolean
  /** A budget cut the read short, so an event today could be missing. */
  partial: boolean
}

export interface IcsPrefilterResult extends IcsPrefilterCounts {
  /** A reduced but valid iCalendar file, or the leading bytes when it never looked like one. */
  text: string
}

export interface IcsPrefilterOptions {
  /** The household day as YYYYMMDD; without it no VEVENT is dropped. */
  day?: string | null
  /** The last household day wanted, when that is more than `day` alone (today and tomorrow). */
  lastDay?: string | null
  /** Stop at the first VEVENT: `calendar-connect-ics` only needs the header and X-WR-CALNAME. */
  headerOnly?: boolean
  slackDays?: number
  maxDownloadBytes?: number
  maxRetainedBytes?: number
  maxLineBytes?: number
  /** Stops the read (the caller's deadline). */
  signal?: AbortSignal
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** YYYYMMDD of a household day, read at its midpoint so a DST-shifted midnight cannot land on the wrong date. */
export function icsDayKey(window: DayWindow, timeZone: string): string {
  const middle = (window.dayStartUtc.getTime() + window.dayEndUtc.getTime()) / 2
  const w = wallTimeAt(middle, timeZone)
  return `${pad(w.year, 4)}${pad(w.month, 2)}${pad(w.day, 2)}`
}

/** YYYYMMDD `days` after `key` (negative moves back). */
/**
 * The first and last household day of a window, for `day` and `lastDay`. Read 12 hours in from each end, which is
 * inside that day whatever DST does to midnight; the midpoint `icsDayKey` uses is only a day for a one-day window.
 */
export function icsDayRange(window: DayWindow, timeZone: string): { day: string; lastDay: string } {
  const key = (ms: number) => {
    const w = wallTimeAt(ms, timeZone)
    return `${pad(w.year, 4)}${pad(w.month, 2)}${pad(w.day, 2)}`
  }
  return { day: key(window.dayStartUtc.getTime() + 12 * 3_600_000), lastDay: key(window.dayEndUtc.getTime() - 12 * 3_600_000) }
}

export function shiftDay(key: string, days: number): string {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) + days))
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`
}

/** The property name of a content line, upper-cased; '' when the line does not start with one. */
function propertyName(line: string): string {
  const limit = Math.min(line.length, 32)
  for (let i = 0; i < limit; i++) {
    const c = line.charCodeAt(i)
    if (c === 58 /* : */ || c === 59 /* ; */) return i === 0 ? '' : line.slice(0, i).toUpperCase()
  }
  return ''
}

/** The YYYYMMDD at the start of a property's value, or null when it is not a date. */
function dateOf(line: string): string | null {
  const colon = line.indexOf(':')
  if (colon < 0 || colon + 9 > line.length) return null
  for (let i = colon + 1; i <= colon + 8; i++) {
    const c = line.charCodeAt(i)
    if (c < 48 || c > 57) return null
  }
  return line.slice(colon + 1, colon + 9)
}

const DURATION_RE = /^[+-]?P(?:(\d+)W)?(?:(\d+)D)?(?:T[\dHMS]*)?$/

/** Whole days a DURATION value covers (rounded up), or null when it cannot be read cheaply. */
function durationDaysOf(line: string): number | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const m = DURATION_RE.exec(line.slice(colon + 1).trim().toUpperCase())
  if (!m) return null
  return (m[1] ? 7 * Number(m[1]) : 0) + (m[2] ? Number(m[2]) : 0) + 1
}

function startsWithBegin(line: string): boolean {
  return line.length > 6 && (line.charCodeAt(0) | 32) === 98 && line.slice(0, 6).toUpperCase() === 'BEGIN:'
}

function startsWithEnd(line: string): boolean {
  return line.length > 4 && (line.charCodeAt(0) | 32) === 101 && line.slice(0, 4).toUpperCase() === 'END:'
}

/**
 * Reads `body` to the end (or to a budget) and returns the reduced calendar. Never throws for size; a read that
 * fails part way through rethrows so the caller can report it.
 */
export async function prefilterIcsStream(body: ReadableStream<Uint8Array> | null, options: IcsPrefilterOptions = {}): Promise<IcsPrefilterResult> {
  const maxDownload = options.maxDownloadBytes ?? ICS_MAX_DOWNLOAD_BYTES
  const maxRetained = options.maxRetainedBytes ?? ICS_MAX_RETAINED_BYTES
  const maxLine = options.maxLineBytes ?? ICS_MAX_LINE_BYTES
  const slack = options.slackDays ?? ICS_PREFILTER_SLACK_DAYS
  const lo = options.day ? shiftDay(options.day, -slack) : null
  const hi = options.day ? shiftDay(options.lastDay ?? options.day, slack) : null

  const header: string[] = []
  const zones: string[] = []
  const events: string[] = []
  let retained = 0
  let bytesRead = 0
  let eventsSeen = 0
  let eventsKept = 0
  let linesDropped = 0
  let downloadLimitHit = false
  let retainedLimitHit = false
  let sawCalendar = false
  /** The leading text, kept only until BEGIN:VCALENDAR shows up, so a non-calendar body can be reported. */
  let prefix = ''
  /** Set to stop reading: 'download' | 'retained' | 'header' | 'not-calendar' | 'aborted'. */
  let stop = ''

  // The component being read, if any.
  let depth = 0
  let kind = ''
  let lines: string[] | null = null
  let blockBytes = 0
  let blockOver = false
  // What the current VEVENT says about itself.
  let recurring = false
  let startDay: string | null = null
  let endDay: string | null = null
  let durationDays: number | null = null
  let unknownDuration = false

  function take(target: string[], bytes: number, from: string[]): void {
    if (blockOver || retained + bytes > maxRetained) {
      retainedLimitHit = true
      stop = 'retained'
      return
    }
    for (const l of from) target.push(l)
    retained += bytes
  }

  function finishBlock(): void {
    if (kind === 'VTIMEZONE' && lines) {
      take(zones, blockBytes, lines)
    } else if (kind === 'VEVENT' && lines) {
      const keep =
        recurring ||
        startDay === null ||
        unknownDuration ||
        lo === null ||
        hi === null ||
        (startDay <= hi && (endDay ?? (durationDays === null ? startDay : shiftDay(startDay, durationDays))) >= lo)
      if (keep) {
        eventsKept++
        take(events, blockBytes, lines)
      }
    }
    kind = ''
    lines = null
    blockBytes = 0
    blockOver = false
  }

  function onLine(line: string, dropped: boolean): void {
    if (!line) return
    if (dropped) linesDropped++

    if (depth > 0) {
      const begin = startsWithBegin(line)
      const end = !begin && startsWithEnd(line)
      if (!begin && !end && depth === 1 && kind === 'VEVENT') {
        const first = line.charCodeAt(0) | 32
        if (first === 100 /* d */ || first === 114 /* r */) {
          switch (propertyName(line)) {
            case 'DTSTART':
              startDay = dateOf(line)
              break
            case 'DTEND':
              endDay = dateOf(line)
              break
            case 'DURATION': {
              const days = durationDaysOf(line)
              if (days === null) unknownDuration = true
              else durationDays = days
              break
            }
            case 'RRULE':
            case 'RDATE':
            case 'RECURRENCE-ID':
              recurring = true
              break
          }
        }
      }
      if (lines && !dropped && !blockOver) {
        lines.push(line)
        blockBytes += line.length + 2
        if (blockBytes > maxRetained) {
          // One absurd block: stop holding it, and refuse it at the end rather than growing without bound.
          blockOver = true
          lines = []
        }
      }
      if (begin) depth++
      else if (end && --depth === 0) finishBlock()
      return
    }

    if (startsWithBegin(line)) {
      const name = line.slice(6).trim().toUpperCase()
      if (name === 'VCALENDAR') {
        sawCalendar = true
        prefix = ''
        return
      }
      if (name === 'VEVENT' && options.headerOnly) {
        stop = 'header'
        return
      }
      depth = 1
      kind = name
      lines = name === 'VTIMEZONE' || name === 'VEVENT' ? [line] : null
      blockBytes = lines ? line.length + 2 : 0
      blockOver = false
      recurring = false
      startDay = null
      endDay = null
      durationDays = null
      unknownDuration = false
      if (name === 'VEVENT') eventsSeen++
      return
    }
    if (startsWithEnd(line)) return
    if (sawCalendar && !dropped) take(header, line.length + 2, [line])
  }

  if (body) {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let pending = ''
    let pendingDropped = false
    /** Inside a logical line already past the cap: everything up to the next newline is thrown away unread. */
    let skipRest = false

    const flushPending = () => {
      if (pending) onLine(pending, pendingDropped)
      pending = ''
      pendingDropped = false
    }
    const onRaw = (raw: string) => {
      const first = raw.charCodeAt(0)
      if ((first === 32 || first === 9) && pending) {
        // RFC 5545 folding: CRLF plus one space or tab continues the line before it.
        if (pendingDropped) return
        if (pending.length + raw.length - 1 > maxLine) {
          pendingDropped = true
          return
        }
        pending += raw.slice(1)
        return
      }
      flushPending()
      pending = raw
      pendingDropped = raw.length > maxLine
    }

    try {
      for (;;) {
        if (stop || options.signal?.aborted) break
        const { done, value } = await reader.read()
        if (done) break
        bytesRead += value.byteLength
        const text = decoder.decode(value, { stream: true })
        if (!sawCalendar && prefix.length < NOT_A_CALENDAR_AFTER_BYTES) prefix += text
        buffer += text
        let start = 0
        for (;;) {
          const nl = buffer.indexOf('\n', start)
          if (skipRest) {
            if (nl === -1) {
              start = buffer.length
              break
            }
            start = nl + 1
            skipRest = false
            continue
          }
          if (nl === -1) {
            // A single line longer than the cap and still arriving: read its head, then throw the rest away unread.
            if (buffer.length - start > maxLine) {
              onRaw(buffer.slice(start, start + maxLine + 1))
              skipRest = true
              start = buffer.length
            }
            break
          }
          const end = nl > start && buffer.charCodeAt(nl - 1) === 13 ? nl - 1 : nl
          onRaw(buffer.slice(start, end))
          start = nl + 1
          if (stop) break
        }
        buffer = buffer.slice(start)
        if (stop) break
        if (bytesRead > maxDownload) {
          downloadLimitHit = true
          stop = 'download'
          break
        }
        if (!sawCalendar && bytesRead > NOT_A_CALENDAR_AFTER_BYTES) {
          stop = 'not-calendar'
          break
        }
      }
      if (!stop) {
        buffer += decoder.decode()
        if (buffer && !skipRest) onRaw(buffer)
        flushPending()
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  const partial = downloadLimitHit || retainedLimitHit
  const text = sawCalendar ? ['BEGIN:VCALENDAR', ...header, ...zones, ...events, 'END:VCALENDAR', ''].join('\r\n') : prefix
  return { text, bytesRead, eventsSeen, eventsKept, retainedBytes: text.length, linesDropped, downloadLimitHit, retainedLimitHit, partial }
}
