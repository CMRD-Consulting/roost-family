import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { householdDayWindow } from './events.ts'
import { createIcsParser } from './ics.ts'
import { icsDayKey, icsDayRange, prefilterIcsStream, shiftDay, type IcsPrefilterOptions } from './icsPrefilter.ts'

const parser = createIcsParser(ICAL)
const ZONE = 'America/New_York'
/** A fixed "now" so fixtures and expectations agree. */
const NOW = new Date('2026-09-21T15:00:00Z')
const WINDOW = householdDayWindow(NOW, ZONE)
const DAY = icsDayKey(WINDOW, ZONE)

function stream(text: string, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close()
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

const run = (text: string, options: IcsPrefilterOptions = {}, chunkSize?: number) =>
  prefilterIcsStream(stream(text, chunkSize), { day: DAY, ...options })

const calendar = (...body: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'X-WR-CALNAME:Family', ...body, 'END:VCALENDAR', ''].join('\r\n')

const vevent = (props: Record<string, string>) =>
  ['BEGIN:VEVENT', ...Object.entries(props).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join('\r\n')

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n')

const titles = (text: string) => parser.parseIcsForDay(text, WINDOW.dayStartUtc, WINDOW.dayEndUtc, ZONE).events.map((e) => e.title)

describe('icsDayKey / shiftDay', () => {
  it('reads the household day, not the UTC day', () => {
    // 00:30 UTC on the 22nd is still the 21st in New York.
    const late = householdDayWindow(new Date('2026-09-22T00:30:00Z'), ZONE)
    expect(icsDayKey(late, ZONE)).toBe('20260921')
    expect(icsDayKey(householdDayWindow(new Date('2026-09-22T00:30:00Z'), 'UTC'), 'UTC')).toBe('20260922')
  })

  it('icsDayRange names the first and last household day of a window, through a DST change', () => {
    expect(icsDayRange(WINDOW, ZONE)).toEqual({ day: '20260921', lastDay: '20260921' })
    expect(icsDayRange(householdDayWindow(NOW, ZONE, 2), ZONE)).toEqual({ day: '20260921', lastDay: '20260922' })
    // Oct 31 + Nov 1 2026 in New York: 49 hours, whose midpoint is still Oct 31.
    expect(icsDayRange(householdDayWindow(new Date('2026-10-31T16:00:00Z'), ZONE, 2), ZONE)).toEqual({ day: '20261031', lastDay: '20261101' })
    expect(icsDayRange(householdDayWindow(new Date('2026-12-31T20:00:00Z'), ZONE, 2), ZONE)).toEqual({ day: '20261231', lastDay: '20270101' })
  })

  it('moves across month and year boundaries', () => {
    expect(shiftDay('20260301', -2)).toBe('20260227')
    expect(shiftDay('20260101', -2)).toBe('20251230')
    expect(shiftDay('20261231', 2)).toBe('20270102')
  })
})

describe('prefilterIcsStream', () => {
  it('keeps the header, every VTIMEZONE and only the events that could be today', async () => {
    const text = calendar(
      VTIMEZONE,
      vevent({ UID: 'old@t', DTSTART: '19990101T120000Z', DTEND: '19990101T130000Z', SUMMARY: 'Ancient' }),
      vevent({ UID: 'today@t', DTSTART: `${DAY}T150000Z`, DTEND: `${DAY}T160000Z`, SUMMARY: 'Swim' }),
      vevent({ UID: 'future@t', DTSTART: '20301231T120000Z', DTEND: '20301231T130000Z', SUMMARY: 'Later' }),
    )
    const out = await run(text)
    expect(out.eventsSeen).toBe(3)
    expect(out.eventsKept).toBe(1)
    expect(out.partial).toBe(false)
    expect(out.text).toContain('X-WR-CALNAME:Family')
    expect(out.text).toContain('BEGIN:VTIMEZONE')
    expect(out.text).toContain('SUMMARY:Swim')
    expect(out.text).not.toContain('Ancient')
    expect(titles(out.text)).toEqual(['Swim'])
  })

  it('keeps a series, an RDATE and an override wherever they start', async () => {
    const text = calendar(
      vevent({ UID: 'r@t', DTSTART: '20100101T120000Z', DTEND: '20100101T130000Z', RRULE: 'FREQ=DAILY', SUMMARY: 'Daily' }),
      vevent({ UID: 'rd@t', DTSTART: '20100102T120000Z', DTEND: '20100102T130000Z', RDATE: `${DAY}T120000Z`, SUMMARY: 'Extra' }),
      vevent({ UID: 'r@t', 'RECURRENCE-ID': '20100105T120000Z', DTSTART: '20100105T140000Z', DTEND: '20100105T150000Z', SUMMARY: 'Moved' }),
    )
    const out = await run(text)
    expect(out.eventsKept).toBe(3)
    expect(titles(out.text)).toContain('Daily')
  })

  it('keeps all-day events on the edges of the day and drops ones well outside', async () => {
    const text = calendar(
      vevent({ UID: 'y@t', 'DTSTART;VALUE=DATE': shiftDay(DAY, -1), 'DTEND;VALUE=DATE': DAY, SUMMARY: 'Yesterday' }),
      vevent({ UID: 'a@t', 'DTSTART;VALUE=DATE': DAY, 'DTEND;VALUE=DATE': shiftDay(DAY, 1), SUMMARY: 'AllDay' }),
      vevent({ UID: 't@t', 'DTSTART;VALUE=DATE': shiftDay(DAY, 1), 'DTEND;VALUE=DATE': shiftDay(DAY, 2), SUMMARY: 'Tomorrow' }),
      vevent({ UID: 'w@t', 'DTSTART;VALUE=DATE': shiftDay(DAY, 30), 'DTEND;VALUE=DATE': shiftDay(DAY, 31), SUMMARY: 'NextMonth' }),
      vevent({ UID: 'span@t', 'DTSTART;VALUE=DATE': shiftDay(DAY, -10), DURATION: 'P20D', SUMMARY: 'LongTrip' }),
    )
    const out = await run(text)
    expect(out.eventsKept).toBe(4)
    expect(out.text).not.toContain('NextMonth')
    expect(titles(out.text)).toEqual(expect.arrayContaining(['AllDay', 'LongTrip']))
  })

  it('with a last day, keeps the same slack after it as before the first', async () => {
    const at = (offset: number, name: string) =>
      vevent({ UID: `${name}@t`, 'DTSTART;VALUE=DATE': shiftDay(DAY, offset), 'DTEND;VALUE=DATE': shiftDay(DAY, offset + 1), SUMMARY: name })
    const text = calendar(at(-4, 'TooEarly'), at(-2, 'EarlyEdge'), at(0, 'Today'), at(1, 'Tomorrow'), at(2, 'TwoOut'), at(3, 'LateEdge'), at(4, 'TooLate'))

    // What the filter kept, whatever day the parser would later show it on.
    const kept = (out: { text: string }) => [...out.text.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]!.trim())

    expect(kept(await run(text, { lastDay: shiftDay(DAY, 1) }))).toEqual(['EarlyEdge', 'Today', 'Tomorrow', 'TwoOut', 'LateEdge'])
    // One day, as before: the slack ends 2 days after it.
    expect(kept(await run(text))).toEqual(['EarlyEdge', 'Today', 'Tomorrow', 'TwoOut'])
  })

  it('keeps an event whose DTSTART it cannot read, and one with an unreadable DURATION', async () => {
    const text = calendar(
      vevent({ UID: 'bad@t', DTSTART: 'not-a-date', SUMMARY: 'Mystery' }),
      vevent({ UID: 'none@t', SUMMARY: 'NoStart' }),
      vevent({ UID: 'dur@t', DTSTART: '20100101T120000Z', DURATION: 'weird', SUMMARY: 'OddDuration' }),
    )
    const out = await run(text)
    expect(out.eventsKept).toBe(3)
  })

  it('drops VTODO, VJOURNAL and VFREEBUSY, which the parser never reads', async () => {
    const text = calendar(
      ['BEGIN:VTODO', 'UID:t@t', `DTSTART:${DAY}T120000Z`, 'SUMMARY:Task', 'END:VTODO'].join('\r\n'),
      ['BEGIN:VJOURNAL', 'UID:j@t', `DTSTART:${DAY}T120000Z`, 'END:VJOURNAL'].join('\r\n'),
      vevent({ UID: 'e@t', DTSTART: `${DAY}T150000Z`, DTEND: `${DAY}T160000Z`, SUMMARY: 'Swim' }),
    )
    const out = await run(text)
    expect(out.text).not.toContain('VTODO')
    expect(out.text).not.toContain('VJOURNAL')
    expect(out.eventsSeen).toBe(1)
  })

  it('keeps a VALARM inside a kept event and is not confused by its DURATION', async () => {
    const text = calendar(
      [
        'BEGIN:VEVENT',
        'UID:a@t',
        `DTSTART:${DAY}T150000Z`,
        `DTEND:${DAY}T160000Z`,
        'SUMMARY:Swim',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT15M',
        'DURATION:PT5M',
        'REPEAT:2',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n'),
      vevent({ UID: 'old@t', DTSTART: '19990101T120000Z', DTEND: '19990101T130000Z', SUMMARY: 'Ancient' }),
    )
    const out = await run(text)
    expect(out.eventsSeen).toBe(2)
    expect(out.eventsKept).toBe(1)
    expect(out.text).toContain('BEGIN:VALARM')
    expect(titles(out.text)).toEqual(['Swim'])
  })

  it('unfolds lines split across chunk boundaries, with CRLF or LF', async () => {
    const folded = ['BEGIN:VEVENT', 'UID:f@t', `DTSTART:${DAY}T150000Z`, `DTEND:${DAY}T160000Z`, 'SUMMARY:A very long swim', ' session at the pool', '\tin town', 'END:VEVENT'].join(
      '\r\n',
    )
    const text = calendar(folded)
    // RFC 5545 unfolding drops the CRLF and the one space or tab that follows it.
    const unfolded = ['A very long swimsession at the poolin town']
    expect(titles(text)).toEqual(unfolded)
    for (const chunkSize of [1, 3, 7, 13, 64, 1024]) {
      const out = await run(text, {}, chunkSize)
      expect(titles(out.text), `chunk ${chunkSize}`).toEqual(unfolded)
    }
    const lf = text.replace(/\r\n/g, '\n')
    for (const chunkSize of [1, 5, 11, 4096]) {
      const out = await run(lf, {}, chunkSize)
      expect(titles(out.text), `LF chunk ${chunkSize}`).toEqual(unfolded)
    }
  })

  it('drops one pathological line but keeps its event', async () => {
    const huge = 'x'.repeat(5_000_000)
    const text = calendar(
      ['BEGIN:VEVENT', 'UID:h@t', `DTSTART:${DAY}T150000Z`, `DTEND:${DAY}T160000Z`, 'SUMMARY:Swim', `DESCRIPTION:${huge}`, 'END:VEVENT'].join('\r\n'),
    )
    const out = await run(text)
    expect(out.linesDropped).toBeGreaterThan(0)
    expect(out.retainedBytes).toBeLessThan(1000)
    expect(out.partial).toBe(false)
    expect(titles(out.text)).toEqual(['Swim'])
  })

  it('drops a pathological folded line the same way', async () => {
    const folded = Array.from({ length: 2000 }, () => ` ${'y'.repeat(70)}`).join('\r\n')
    const text = calendar(
      ['BEGIN:VEVENT', 'UID:h@t', `DTSTART:${DAY}T150000Z`, `DTEND:${DAY}T160000Z`, 'SUMMARY:Swim', 'DESCRIPTION:start', folded, 'END:VEVENT'].join('\r\n'),
    )
    const out = await run(text, { maxLineBytes: 2000 })
    expect(out.linesDropped).toBe(1)
    expect(titles(out.text)).toEqual(['Swim'])
  })

  it('stops reading and reports partial past the download budget', async () => {
    const filler = new TextEncoder().encode(vevent({ UID: 'p@t', DTSTART: '19990101T120000Z', DTEND: '19990101T130000Z', SUMMARY: 'Ancient' }) + '\r\n')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
      },
      pull(controller) {
        controller.enqueue(filler.slice())
      },
    })
    const out = await prefilterIcsStream(body, { day: DAY, maxDownloadBytes: 25_000_000 })
    expect(out.downloadLimitHit).toBe(true)
    expect(out.partial).toBe(true)
    expect(out.bytesRead).toBeGreaterThan(25_000_000)
    expect(out.bytesRead).toBeLessThan(26_000_000)
    expect(out.text.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('returns what it kept and reports partial past the retained budget', async () => {
    const body = 5_000
    const text = calendar(
      ...Array.from({ length: body }, (_, i) => vevent({ UID: `x${i}@t`, DTSTART: `${DAY}T150000Z`, DTEND: `${DAY}T160000Z`, SUMMARY: `Event ${i}` })),
    )
    const out = await prefilterIcsStream(stream(text), { day: DAY, maxRetainedBytes: 100_000 })
    expect(out.retainedLimitHit).toBe(true)
    expect(out.partial).toBe(true)
    expect(out.eventsSeen).toBeLessThan(body)
    expect(out.retainedBytes).toBeLessThanOrEqual(100_100)
    expect(titles(out.text).length).toBeGreaterThan(100)
    expect(titles(out.text)[0]).toBe('Event 0')
  })

  it('keeps all 5,000 of today\'s events when they fit the real retained budget', async () => {
    const text = calendar(
      ...Array.from({ length: 5_000 }, (_, i) => vevent({ UID: `x${i}@t`, DTSTART: `${DAY}T150000Z`, DTEND: `${DAY}T160000Z`, SUMMARY: `Event ${i}` })),
    )
    const out = await run(text)
    expect(out.eventsKept).toBe(5_000)
    expect(out.partial).toBe(false)
    expect(out.retainedBytes).toBeLessThan(2_000_000)
  })

  it('stops at the first VEVENT for headerOnly, keeping the name', async () => {
    const text = calendar(VTIMEZONE, ...Array.from({ length: 200 }, (_, i) => vevent({ UID: `x${i}@t`, DTSTART: '20100101T120000Z', SUMMARY: `E${i}` })))
    const out = await prefilterIcsStream(stream(text, 512), { headerOnly: true })
    expect(out.eventsSeen).toBe(0)
    expect(out.text).not.toContain('BEGIN:VEVENT')
    expect(out.bytesRead).toBeLessThan(text.length)
    expect(parser.readIcsCalendarName(out.text)).toBe('Family')
  })

  it('gives up early on a body that is not a calendar', async () => {
    const html = `<html><body>${'sign in '.repeat(200_000)}</body></html>`
    const out = await prefilterIcsStream(stream(html), { day: DAY })
    expect(out.bytesRead).toBeLessThan(200_000)
    expect(() => parser.readIcsCalendarName(out.text)).toThrow()
  })

  it('handles an empty body', async () => {
    const out = await prefilterIcsStream(null, { day: DAY })
    expect(out.text).toBe('')
    expect(out.partial).toBe(false)
  })
})

// ---- Generated fixtures: the shapes real subscriptions have ----

interface FixtureOptions {
  singles: number
  recurring: number
  /** Years of history the singles are spread over, ending today. */
  years: number
  /** Padding per event, to reach a target file size. */
  padBytes?: number
  /** Put the series and today's event at the top, as a feed whose order is not chronological would. */
  interestingFirst?: boolean
}

function generateCalendar({ singles, recurring, years, padBytes = 0, interestingFirst = false }: FixtureOptions): string {
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Personal', VTIMEZONE]
  const end = Date.UTC(Number(DAY.slice(0, 4)), Number(DAY.slice(4, 6)) - 1, Number(DAY.slice(6, 8)))
  const span = years * 365 * 24 * 3_600_000
  // Folded padding on the history, the way a real DESCRIPTION arrives; today's blocks stay the usual small size.
  const pad = padBytes > 0 ? ['DESCRIPTION:' + 'n'.repeat(60), ...Array.from({ length: Math.ceil(padBytes / 74) }, () => ' ' + 'n'.repeat(72))] : []
  const past: string[] = []
  const now: string[] = []
  for (let i = 0; i < singles; i++) {
    const at = new Date(end - Math.floor((span * (i + 1)) / (singles + 1)))
    const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    past.push(
      'BEGIN:VEVENT',
      `UID:single-${i}@example.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${stamp.slice(0, 15)}`,
      `DTEND;TZID=America/New_York:${stamp.slice(0, 9)}${String(Number(stamp.slice(9, 11)) + 1).padStart(2, '0')}${stamp.slice(11, 15)}`,
      `SUMMARY:Past event ${i}`,
      'LOCATION:Somewhere',
      ...pad,
      'END:VEVENT',
    )
  }
  for (let i = 0; i < recurring; i++) {
    now.push(
      'BEGIN:VEVENT',
      `UID:series-${i}@example.com`,
      'DTSTAMP:20200101T000000Z',
      `DTSTART;TZID=America/New_York:2020010${(i % 9) + 1}T0${(i % 9) + 1}0000`,
      `DTEND;TZID=America/New_York:2020010${(i % 9) + 1}T0${(i % 9) + 1}3000`,
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      `SUMMARY:Series ${i}`,
      'END:VEVENT',
    )
  }
  now.push(
    'BEGIN:VEVENT',
    'UID:today@example.com',
    'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=America/New_York:${DAY}T090000`,
    `DTEND;TZID=America/New_York:${DAY}T100000`,
    'SUMMARY:Dentist',
    'END:VEVENT',
  )
  const body = interestingFirst ? now.concat(past) : past.concat(now)
  return head.concat(body, 'END:VCALENDAR', '').join('\r\n')
}

describe('prefilterIcsStream on real-sized calendars', () => {
  it('reduces a 1.8 MB personal export (2,245 events since 1970) to tens of KB, fast', async () => {
    const text = generateCalendar({ singles: 2_078, recurring: 166, years: 56, padBytes: 620 })
    expect(text.length).toBeGreaterThan(1_500_000)
    expect(text.length).toBeLessThan(2_200_000)

    const started = performance.now()
    const out = await run(text)
    const elapsed = performance.now() - started

    expect(out.eventsSeen).toBe(2_245)
    expect(out.eventsKept).toBeLessThan(180)
    expect(out.retainedBytes).toBeLessThan(100_000)
    expect(out.partial).toBe(false)
    expect(elapsed).toBeLessThan(200)

    const shown = titles(out.text)
    expect(shown).toContain('Dentist')
    expect(shown.filter((t) => t.startsWith('Series ')).length).toBeGreaterThan(100)
  })

  it('handles a 9 MB, 40,000-event, ten-year calendar well under a second', async () => {
    const text = generateCalendar({ singles: 39_950, recurring: 50, years: 10 })
    expect(text.length).toBeGreaterThan(8_500_000)
    expect(text.length).toBeLessThan(11_000_000)

    const started = performance.now()
    const out = await run(text)
    const elapsed = performance.now() - started

    expect(out.eventsSeen).toBe(40_001)
    expect(out.eventsKept).toBeLessThan(100)
    expect(out.retainedBytes).toBeLessThan(60_000)
    expect(out.partial).toBe(false)
    expect(elapsed).toBeLessThan(1_000)

    const parseStarted = performance.now()
    const shown = titles(out.text)
    expect(performance.now() - parseStarted).toBeLessThan(1_000)
    expect(shown).toContain('Dentist')
  })

  it('stops a 25 MB calendar at the download budget and still shows what it read', async () => {
    const text = generateCalendar({ singles: 2_000, recurring: 20, years: 10, padBytes: 12_000, interestingFirst: true })
    expect(text.length).toBeGreaterThan(24_000_000)
    const out = await run(text)
    expect(out.downloadLimitHit).toBe(true)
    expect(out.partial).toBe(true)
    expect(out.bytesRead).toBeLessThan(21_000_000)
    expect(out.bytesRead).toBeGreaterThan(19_000_000)
    // Everything read before the budget still shows; the rest is why the answer is `partial`.
    expect(titles(out.text)).toContain('Dentist')
  })

  it('loses no event that the unfiltered text would have shown (mixed fixture)', async () => {
    const mixed = calendar(
      VTIMEZONE,
      vevent({ UID: 'a@t', DTSTART: `${DAY}T130000Z`, DTEND: `${DAY}T140000Z`, SUMMARY: 'Timed today' }),
      vevent({ UID: 'b@t', 'DTSTART;VALUE=DATE': DAY, 'DTEND;VALUE=DATE': shiftDay(DAY, 1), SUMMARY: 'All day today' }),
      vevent({ UID: 'c@t', 'DTSTART;TZID=America/New_York': `${DAY}T235900`, 'DTEND;TZID=America/New_York': `${shiftDay(DAY, 1)}T000900`, SUMMARY: 'Just before midnight' }),
      vevent({ UID: 'd@t', 'DTSTART;TZID=America/New_York': `${DAY}T000000`, 'DTEND;TZID=America/New_York': `${DAY}T001500`, SUMMARY: 'Just after midnight' }),
      vevent({ UID: 'e@t', DTSTART: `${shiftDay(DAY, -1)}T220000Z`, DTEND: `${DAY}T160000Z`, SUMMARY: 'Overnight' }),
      vevent({ UID: 'f@t', DTSTART: '20200106T120000Z', DTEND: '20200106T130000Z', RRULE: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', SUMMARY: 'Every day' }),
      vevent({ UID: 'g@t', DTSTART: '20200101T120000Z', DTEND: '20200101T130000Z', RRULE: 'FREQ=YEARLY;COUNT=3', SUMMARY: 'Yearly (ended)' }),
      vevent({ UID: 'h@t', DTSTART: '20200105T090000Z', DTEND: '20200105T100000Z', RDATE: `${DAY}T110000Z`, SUMMARY: 'By RDATE' }),
      vevent({ UID: 'f@t', 'RECURRENCE-ID': `${DAY}T120000Z`, DTSTART: `${DAY}T173000Z`, DTEND: `${DAY}T183000Z`, SUMMARY: 'Every day (moved)' }),
      vevent({ UID: 'i@t', DTSTART: '19990101T120000Z', DTEND: '19990101T130000Z', SUMMARY: 'Ancient' }),
      vevent({ UID: 'j@t', DTSTART: '20301231T120000Z', DTEND: '20301231T130000Z', SUMMARY: 'Far future' }),
      vevent({ UID: 'k@t', 'DTSTART;VALUE=DATE': shiftDay(DAY, -3), DURATION: 'P7D', SUMMARY: 'Week off' }),
      vevent({ UID: 'l@t', DTSTART: 'garbage', SUMMARY: 'Unparseable' }),
      vevent({ UID: 'm@t', DTSTART: `${DAY}T140000Z`, DTEND: `${DAY}T150000Z`, STATUS: 'CANCELLED', SUMMARY: 'Cancelled' }),
    )
    const out = await run(mixed)
    expect(titles(out.text).sort()).toEqual(titles(mixed).sort())
    expect(titles(out.text).length).toBeGreaterThan(5)
  })
})
