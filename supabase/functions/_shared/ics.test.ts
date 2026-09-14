import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { householdDayWindow } from './events'
import { IcsParseError, createIcsParser } from './ics'

const TZ = 'America/New_York'
const { parseIcsForDay, readIcsCalendarName } = createIcsParser(ICAL)

/** Joins lines with CRLF, as RFC 5545 requires. */
function ics(...lines: string[]): string {
  return lines.join('\r\n') + '\r\n'
}

const NEW_YORK_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

function calendar(...body: string[]): string {
  return ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roost//Test//EN', 'X-WR-CALNAME:Sam', ...NEW_YORK_VTIMEZONE, ...body, 'END:VCALENDAR')
}

/** Parses `text` for the household day containing `isoDay` (noon local, so any DST day works). */
function parseOn(text: string, isoDay: string, timeZone = TZ) {
  const { dayStartUtc, dayEndUtc } = householdDayWindow(new Date(`${isoDay}T16:00:00Z`), timeZone)
  return parseIcsForDay(text, dayStartUtc, dayEndUtc, timeZone)
}

function eventsOn(text: string, isoDay: string, timeZone = TZ) {
  const result = parseOn(text, isoDay, timeZone)
  expect(result.partial).toBe(false)
  return result.events
}

/** Parses and returns the events plus the elapsed milliseconds. */
function timed(text: string, isoDay: string) {
  const started = performance.now()
  const result = parseOn(text, isoDay)
  return { ...result, ms: performance.now() - started }
}

function titles(events: Array<{ title: string }>): string[] {
  return events.map((e) => e.title)
}

describe('parseIcsForDay: single events', () => {
  it('converts a timed event with a TZID and VTIMEZONE to UTC and keeps only the minimal fields', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:dentist-1',
      'DTSTART;TZID=America/New_York:20260914T093000',
      'DTEND;TZID=America/New_York:20260914T103000',
      'SUMMARY:Dentist',
      'LOCATION:12 Oak St\\, Raleigh',
      'DESCRIPTION:Bring the insurance card',
      'ORGANIZER:mailto:office@example.com',
      'ATTENDEE:mailto:sam@example.com',
      'URL:https://example.com/appointment',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:other-day',
      'DTSTART;TZID=America/New_York:20260915T093000',
      'DTEND;TZID=America/New_York:20260915T103000',
      'SUMMARY:Tomorrow',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      {
        title: 'Dentist',
        startAt: '2026-09-14T13:30:00.000Z',
        endAt: '2026-09-14T14:30:00.000Z',
        allDay: false,
        location: '12 Oak St, Raleigh',
      },
    ])
  })

  it('handles UTC times, floating times (household zone), DURATION, a missing DTEND and a missing SUMMARY', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:utc',
      'DTSTART:20260914T120000Z',
      'DTEND:20260914T123000Z',
      'SUMMARY:UTC call',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:floating',
      'DTSTART:20260914T080000',
      'DURATION:PT45M',
      'SUMMARY:Floating breakfast',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:instant',
      'DTSTART:20260914T200000Z',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      { title: 'UTC call', startAt: '2026-09-14T12:00:00.000Z', endAt: '2026-09-14T12:30:00.000Z', allDay: false, location: null },
      { title: 'Floating breakfast', startAt: '2026-09-14T12:00:00.000Z', endAt: '2026-09-14T12:45:00.000Z', allDay: false, location: null },
      { title: '(No title)', startAt: '2026-09-14T20:00:00.000Z', endAt: '2026-09-14T20:00:00.000Z', allDay: false, location: null },
    ])
  })

  it('uses the IANA zone named by a TZID that has no VTIMEZONE', () => {
    const text = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:chicago',
      'DTSTART;TZID=America/Chicago:20260914T090000',
      'DTEND;TZID=America/Chicago:20260914T100000',
      'SUMMARY:Chicago meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    expect(eventsOn(text, '2026-09-14')).toMatchObject([
      { title: 'Chicago meeting', startAt: '2026-09-14T14:00:00.000Z', endAt: '2026-09-14T15:00:00.000Z' },
    ])
  })

  it('uses a VTIMEZONE whose TZID is not an IANA name (as Outlook exports)', () => {
    const text = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...NEW_YORK_VTIMEZONE.map((line) => (line === 'TZID:America/New_York' ? 'TZID:Eastern Standard Time' : line)),
      'BEGIN:VEVENT',
      'UID:outlook',
      'DTSTART;TZID=Eastern Standard Time:20261102T090000',
      'DTEND;TZID=Eastern Standard Time:20261102T100000',
      'SUMMARY:Outlook meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    expect(eventsOn(text, '2026-11-02')).toMatchObject([
      { title: 'Outlook meeting', startAt: '2026-11-02T14:00:00.000Z', endAt: '2026-11-02T15:00:00.000Z' },
    ])
  })
})

describe('parseIcsForDay: all-day events', () => {
  it('places DATE values at midnight in the household zone and includes multi-day events covering today', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:today',
      'DTSTART;VALUE=DATE:20260914',
      'DTEND;VALUE=DATE:20260915',
      'SUMMARY:Teacher workday',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:trip',
      'DTSTART;VALUE=DATE:20260913',
      'DTEND;VALUE=DATE:20260916',
      'SUMMARY:Grandma visiting',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:no-end',
      'DTSTART;VALUE=DATE:20260914',
      'SUMMARY:Library books due',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:yesterday',
      'DTSTART;VALUE=DATE:20260913',
      'DTEND;VALUE=DATE:20260914',
      'SUMMARY:Yesterday',
      'END:VEVENT',
    )
    const events = eventsOn(text, '2026-09-14')
    expect(events).toContainEqual({
      title: 'Teacher workday',
      startAt: '2026-09-14T04:00:00.000Z',
      endAt: '2026-09-15T04:00:00.000Z',
      allDay: true,
      location: null,
    })
    expect(events).toContainEqual({
      title: 'Grandma visiting',
      startAt: '2026-09-13T04:00:00.000Z',
      endAt: '2026-09-16T04:00:00.000Z',
      allDay: true,
      location: null,
    })
    expect(events).toContainEqual({
      title: 'Library books due',
      startAt: '2026-09-14T04:00:00.000Z',
      endAt: '2026-09-15T04:00:00.000Z',
      allDay: true,
      location: null,
    })
    expect(titles(events)).not.toContain('Yesterday')
  })
})

describe('parseIcsForDay: recurrence', () => {
  const weekly = (uid: string, summary: string, start: string, ...extra: string[]) => [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;TZID=America/New_York:${start}`,
    'DURATION:PT1H',
    'RRULE:FREQ=WEEKLY;BYDAY=MO',
    `SUMMARY:${summary}`,
    ...extra,
    'END:VEVENT',
  ]

  it('expands a weekly RRULE and honors EXDATE', () => {
    const text = calendar(
      ...weekly('soccer', 'Soccer', '20260831T160000', 'EXDATE;TZID=America/New_York:20260914T160000'),
      ...weekly('swim', 'Swim', '20260105T070000'),
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      { title: 'Swim', startAt: '2026-09-14T11:00:00.000Z', endAt: '2026-09-14T12:00:00.000Z', allDay: false, location: null },
    ])
    expect(eventsOn(text, '2026-09-21')).toMatchObject([
      { title: 'Swim', startAt: '2026-09-21T11:00:00.000Z' },
      { title: 'Soccer', startAt: '2026-09-21T20:00:00.000Z', endAt: '2026-09-21T21:00:00.000Z' },
    ])
    expect(eventsOn(text, '2026-09-15')).toEqual([])
  })

  it('stops at COUNT and UNTIL', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:count',
      'DTSTART;TZID=America/New_York:20260831T090000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'SUMMARY:Two lessons',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:until',
      'DTSTART;TZID=America/New_York:20260831T100000',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;UNTIL=20260913T235959Z',
      'SUMMARY:Camp',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-07')).toMatchObject([{ title: 'Two lessons' }, { title: 'Camp' }])
    expect(eventsOn(text, '2026-09-14')).toEqual([])
  })

  it('applies an overridden instance (RECURRENCE-ID), including instances moved into or out of today', () => {
    const text = calendar(
      ...weekly('piano', 'Piano', '20260831T150000', 'LOCATION:Music school'),
      'BEGIN:VEVENT',
      'UID:piano',
      'RECURRENCE-ID;TZID=America/New_York:20260914T150000',
      'DTSTART;TZID=America/New_York:20260914T170000',
      'DTEND;TZID=America/New_York:20260914T180000',
      'SUMMARY:Piano (moved)',
      'LOCATION:Teacher’s house',
      'END:VEVENT',
      ...weekly('art', 'Art', '20260831T100000'),
      // Next week's Art is pulled into today; today's Art is pushed to Wednesday.
      'BEGIN:VEVENT',
      'UID:art',
      'RECURRENCE-ID;TZID=America/New_York:20260921T100000',
      'DTSTART;TZID=America/New_York:20260914T190000',
      'DTEND;TZID=America/New_York:20260914T200000',
      'SUMMARY:Art (pulled in)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:art',
      'RECURRENCE-ID;TZID=America/New_York:20260914T100000',
      'DTSTART;TZID=America/New_York:20260916T100000',
      'DTEND;TZID=America/New_York:20260916T110000',
      'SUMMARY:Art (pushed out)',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      { title: 'Piano (moved)', startAt: '2026-09-14T21:00:00.000Z', endAt: '2026-09-14T22:00:00.000Z', allDay: false, location: 'Teacher’s house' },
      { title: 'Art (pulled in)', startAt: '2026-09-14T23:00:00.000Z', endAt: '2026-09-15T00:00:00.000Z', allDay: false, location: null },
    ])
    expect(eventsOn(text, '2026-09-16')).toMatchObject([{ title: 'Art (pushed out)', startAt: '2026-09-16T14:00:00.000Z' }])
    expect(eventsOn(text, '2026-09-21')).toMatchObject([{ title: 'Piano', location: 'Music school' }])
  })

  it('skips a cancelled instance and a cancelled series', () => {
    const text = calendar(
      ...weekly('gym', 'Gym', '20260831T060000'),
      'BEGIN:VEVENT',
      'UID:gym',
      'RECURRENCE-ID;TZID=America/New_York:20260914T060000',
      'DTSTART;TZID=America/New_York:20260914T060000',
      'DURATION:PT1H',
      'STATUS:CANCELLED',
      'SUMMARY:Gym',
      'END:VEVENT',
      ...weekly('book-club', 'Book club', '20260831T200000', 'STATUS:CANCELLED'),
      'BEGIN:VEVENT',
      'UID:call-off',
      'DTSTART;TZID=America/New_York:20260914T120000',
      'DURATION:PT1H',
      'STATUS:CANCELLED',
      'SUMMARY:Cancelled lunch',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([])
    expect(titles(eventsOn(text, '2026-09-21'))).toEqual(['Gym'])
  })

  it('keeps wall-clock times across the 2026-11-01 DST change (VTIMEZONE and IANA fallback)', () => {
    const sundays = (tzBlock: string[], tzid: string) =>
      ics(
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...tzBlock,
        'BEGIN:VEVENT',
        'UID:church',
        `DTSTART;TZID=${tzid}:20261004T090000`,
        `DTEND;TZID=${tzid}:20261004T100000`,
        'RRULE:FREQ=WEEKLY;BYDAY=SU',
        'SUMMARY:Service',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:overnight',
        `DTSTART;TZID=${tzid}:20261101T003000`,
        `DTEND;TZID=${tzid}:20261101T033000`,
        'SUMMARY:Night shift',
        'END:VEVENT',
        'END:VCALENDAR',
      )
    for (const text of [sundays(NEW_YORK_VTIMEZONE, 'America/New_York'), sundays([], 'America/New_York')]) {
      expect(eventsOn(text, '2026-10-25')).toMatchObject([{ title: 'Service', startAt: '2026-10-25T13:00:00.000Z' }])
      expect(eventsOn(text, '2026-11-01')).toEqual([
        // 00:30 EDT → 03:30 EST is four real hours.
        { title: 'Night shift', startAt: '2026-11-01T04:30:00.000Z', endAt: '2026-11-01T08:30:00.000Z', allDay: false, location: null },
        { title: 'Service', startAt: '2026-11-01T14:00:00.000Z', endAt: '2026-11-01T15:00:00.000Z', allDay: false, location: null },
      ])
    }
  })

  it('handles DTEND with its own TZID (no VTIMEZONE), for single and recurring events', () => {
    const text = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cross-zone',
      'DTSTART;TZID=America/New_York:20260914T090000',
      'DTEND;TZID=America/Chicago:20260914T090000',
      'SUMMARY:Flight',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:cross-zone-weekly',
      'DTSTART;TZID=America/New_York:20260831T180000',
      'DTEND;TZID=America/Chicago:20260831T180000',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Weekly flight',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    expect(eventsOn(text, '2026-09-14')).toMatchObject([
      { title: 'Flight', startAt: '2026-09-14T13:00:00.000Z', endAt: '2026-09-14T14:00:00.000Z' },
      { title: 'Weekly flight', startAt: '2026-09-14T22:00:00.000Z', endAt: '2026-09-14T23:00:00.000Z' },
    ])
  })
})

describe('parseIcsForDay: EXDATE and RECURRENCE-ID in a different form than DTSTART', () => {
  it('honors a UTC EXDATE and a UTC RECURRENCE-ID when DTSTART has an IANA TZID without VTIMEZONE', () => {
    const text = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:standup',
      'DTSTART;TZID=America/New_York:20260831T090000',
      'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20260914T130000Z',
      'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:lesson',
      'DTSTART;TZID=America/New_York:20260831T150000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Lesson',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:lesson',
      'RECURRENCE-ID:20260914T190000Z',
      'DTSTART;TZID=America/New_York:20260914T170000',
      'DURATION:PT1H',
      'SUMMARY:Lesson (moved)',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      { title: 'Lesson (moved)', startAt: '2026-09-14T21:00:00.000Z', endAt: '2026-09-14T22:00:00.000Z', allDay: false, location: null },
    ])
    expect(titles(eventsOn(text, '2026-09-21'))).toEqual(['Standup', 'Lesson'])
  })

  it('honors a TZID EXDATE and RECURRENCE-ID (no VTIMEZONE) when DTSTART is UTC', () => {
    const text = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:utc-series',
      'DTSTART:20260831T130000Z',
      'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY',
      'EXDATE;TZID=America/New_York:20260914T090000',
      'SUMMARY:UTC standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:utc-lesson',
      'DTSTART:20260831T190000Z',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:UTC lesson',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:utc-lesson',
      'RECURRENCE-ID;TZID=America/New_York:20260914T150000',
      'DTSTART:20260914T210000Z',
      'DURATION:PT1H',
      'SUMMARY:UTC lesson (moved)',
      'END:VEVENT',
      'END:VCALENDAR',
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['UTC lesson (moved)'])
  })
})

describe('parseIcsForDay: duplicate UIDs and stray overrides', () => {
  it('shows every non-recurring VEVENT that shares a UID, and links overrides only to the recurring one', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:shared',
      'DTSTART;TZID=America/New_York:20260914T080000',
      'DURATION:PT30M',
      'SUMMARY:First copy',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:shared',
      'DTSTART;TZID=America/New_York:20260914T120000',
      'DURATION:PT30M',
      'SUMMARY:Second copy',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:shared',
      'DTSTART;TZID=America/New_York:20260831T160000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Series',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:shared',
      'RECURRENCE-ID;TZID=America/New_York:20260914T160000',
      'DTSTART;TZID=America/New_York:20260914T170000',
      'DURATION:PT1H',
      'SUMMARY:Series (moved)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:shared',
      'DTSTART;TZID=America/New_York:20260901T070000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Second series',
      'END:VEVENT',
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['First copy', 'Second copy', 'Series (moved)'])
    expect(titles(eventsOn(text, '2026-09-21'))).toEqual(['Series'])
    expect(titles(eventsOn(text, '2026-09-15'))).toEqual(['Second series'])
  })

  it('shows an override moved into today whose RECURRENCE-ID is not a generated instance', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:odd',
      'DTSTART;TZID=America/New_York:20260831T100000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'SUMMARY:Tutoring',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:odd',
      'RECURRENCE-ID;TZID=America/New_York:20261007T103000',
      'DTSTART;TZID=America/New_York:20260914T190000',
      'DURATION:PT1H',
      'SUMMARY:Tutoring (extra)',
      'END:VEVENT',
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['Tutoring', 'Tutoring (extra)'])
  })

  it('shows an override moved into today after a COUNT series has ended', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:short',
      'DTSTART;TZID=America/New_York:20260831T100000',
      'DURATION:PT1H',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'SUMMARY:Short course',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:short',
      'RECURRENCE-ID;TZID=America/New_York:20260907T100000',
      'DTSTART;TZID=America/New_York:20260914T100000',
      'DURATION:PT1H',
      'SUMMARY:Short course (make-up)',
      'END:VEVENT',
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['Short course (make-up)'])
    expect(eventsOn(text, '2026-09-07')).toEqual([])
  })
})

describe('parseIcsForDay: long-running series', () => {
  const series = (i: number, tzid: string, start: string, rule: string, duration = 'PT15M') => [
    'BEGIN:VEVENT',
    `UID:series-${i}`,
    `DTSTART;TZID=${tzid}:${start}`,
    `DURATION:${duration}`,
    `RRULE:${rule}`,
    `SUMMARY:Series ${i}`,
    'END:VEVENT',
  ]
  const sixtyDaily = (withVtimezone: boolean) =>
    ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...(withVtimezone ? NEW_YORK_VTIMEZONE : []),
      ...Array.from({ length: 60 }, (_, i) =>
        series(i, 'America/New_York', `20200101T${String(6 + Math.floor(i / 5)).padStart(2, '0')}${String(i % 60).padStart(2, '0')}00`, 'FREQ=DAILY'),
      ).flat(),
      'END:VCALENDAR',
    )

  for (const withVtimezone of [false, true]) {
    it(`returns all of 60 daily series since 2020 quickly (${withVtimezone ? 'with' : 'without'} VTIMEZONE)`, () => {
      const text = sixtyDaily(withVtimezone)
      parseOn(text, '2026-09-13') // warm up
      const { events, partial, ms } = timed(text, '2026-09-14')
      expect(partial).toBe(false)
      expect(events).toHaveLength(60)
      expect(events[0]).toMatchObject({ title: 'Series 0', startAt: '2026-09-14T10:00:00.000Z' })
      expect(ms).toBeLessThan(500)
    })
  }

  it('returns a daily series from 1970 quickly', () => {
    const text = calendar(...series(1, 'America/New_York', '19700101T080000', 'FREQ=DAILY', 'PT5M'))
    const { events, partial, ms } = timed(text, '2026-09-14')
    expect(partial).toBe(false)
    expect(events).toMatchObject([{ startAt: '2026-09-14T12:00:00.000Z' }])
    expect(ms).toBeLessThan(100)
  })

  it("returns today's instances of an hourly series from 2023", () => {
    const text = calendar(...series(1, 'America/New_York', '20230101T000000', 'FREQ=HOURLY', 'PT30M'))
    const { events, partial, ms } = timed(text, '2026-09-14')
    expect(partial).toBe(false)
    expect(events).toHaveLength(24)
    expect(events[0]!.startAt).toBe('2026-09-14T04:00:00.000Z')
    expect(events[23]!.startAt).toBe('2026-09-15T03:00:00.000Z')
    expect(ms).toBeLessThan(100)
  })

  it('keeps BYDAY, BYMONTHDAY, BYSETPOS, INTERVAL and leap-day anchors when skipping ahead', () => {
    const text = calendar(
      // Every other week on Mon/Wed/Fri from Mon 2015-01-05: 2026-09-14 is 610 weeks later (even).
      ...series(1, 'America/New_York', '20150105T070000', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR'),
      // Every other week from Mon 2015-01-12: odd weeks, so not on 2026-09-14.
      ...series(2, 'America/New_York', '20150112T070000', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'),
      // Second Tuesday monthly: 2026-09-08.
      ...series(3, 'America/New_York', '20100112T080000', 'FREQ=MONTHLY;BYDAY=2TU'),
      // Monthly on the 31st: months without one are skipped.
      ...series(4, 'America/New_York', '20190131T090000', 'FREQ=MONTHLY'),
      // Last weekday of the month.
      ...series(5, 'America/New_York', '20100129T100000', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'),
      // Every 3 days from 2000-01-01: 2026-09-14 is 9753 days later (multiple of 3).
      ...series(6, 'America/New_York', '20000101T110000', 'FREQ=DAILY;INTERVAL=3'),
      // Leap day yearly.
      ...series(7, 'America/New_York', '20000229T120000', 'FREQ=YEARLY'),
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['Series 1', 'Series 6'])
    expect(titles(eventsOn(text, '2026-09-16'))).toEqual(['Series 1'])
    expect(titles(eventsOn(text, '2026-09-21'))).toEqual(['Series 2'])
    expect(titles(eventsOn(text, '2026-09-08'))).toEqual(['Series 3', 'Series 6'])
    expect(titles(eventsOn(text, '2026-08-31'))).toEqual(['Series 1', 'Series 4', 'Series 5'])
    expect(titles(eventsOn(text, '2026-09-30'))).toEqual(['Series 1', 'Series 5'])
    expect(titles(eventsOn(text, '2026-10-31'))).toEqual(['Series 4'])
    expect(titles(eventsOn(text, '2028-02-29'))).toContain('Series 7')
    expect(titles(eventsOn(text, '2027-02-28'))).not.toContain('Series 7')
  })

  it('iterates COUNT series from the start and still finds today', () => {
    const text = calendar(...series(1, 'America/New_York', '20000101T080000', 'FREQ=DAILY;COUNT=20000', 'PT5M'))
    const { events, partial, ms } = timed(text, '2026-09-14')
    expect(partial).toBe(false)
    expect(events).toHaveLength(1)
    expect(ms).toBeLessThan(2000) // generous: a bound on runaway iteration, not a benchmark (flaked at 500 ms under parallel load)
  })

  it('reports partial results instead of silently dropping a series that exceeds the budget', () => {
    const text = calendar(
      ...series(1, 'America/New_York', '20000101T000000', 'FREQ=MINUTELY;COUNT=50000000', 'PT1M'),
      ...series(2, 'America/New_York', '20260914T090000', 'FREQ=DAILY'),
    )
    const { events, partial } = parseOn(text, '2026-09-14')
    expect(partial).toBe(true)
    expect(titles(events)).toContain('Series 2')
  })
})

describe('parseIcsForDay: day window edges', () => {
  it('includes an event in progress at the start of the day and excludes one that ended exactly then', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:sleepover',
      'DTSTART;TZID=America/New_York:20260913T220000',
      'DTEND;TZID=America/New_York:20260914T010000',
      'SUMMARY:Sleepover pickup window',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:ends-at-midnight',
      'DTSTART;TZID=America/New_York:20260913T230000',
      'DTEND;TZID=America/New_York:20260914T000000',
      'SUMMARY:Ends at midnight',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:starts-at-midnight-tomorrow',
      'DTSTART;TZID=America/New_York:20260915T000000',
      'DTEND;TZID=America/New_York:20260915T010000',
      'SUMMARY:Tomorrow at midnight',
      'END:VEVENT',
    )
    expect(eventsOn(text, '2026-09-14')).toEqual([
      {
        title: 'Sleepover pickup window',
        startAt: '2026-09-14T02:00:00.000Z',
        endAt: '2026-09-14T05:00:00.000Z',
        allDay: false,
        location: null,
      },
    ])
  })
})

describe('parseIcsForDay: robustness', () => {
  it('ignores malformed VEVENTs and keeps the good ones', () => {
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:garbage-line',
      'DTSTART;TZID=America/New_York:20260914T090000',
      'THIS LINE HAS NO COLON',
      'SUMMARY:Broken line',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:bad-date',
      'DTSTART:notadate',
      'SUMMARY:Bad date',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:no-start',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:bad-rule',
      'DTSTART;TZID=America/New_York:20260914T090000',
      'RRULE:FREQ=SOMETIMES',
      'SUMMARY:Bad rule',
      'END:VEVENT',
      'BEGIN:VTODO',
      'UID:todo',
      'SUMMARY:Not an event',
      'END:VTODO',
      'BEGIN:VEVENT',
      'UID:good',
      'DTSTART;TZID=America/New_York:20260914T110000',
      'DTEND;TZID=America/New_York:20260914T120000',
      'SUMMARY:Good event',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
    )
    expect(titles(eventsOn(text, '2026-09-14'))).toEqual(['Good event'])
    expect(readIcsCalendarName(text)).toBe('Sam')
  })

  it('never returns descriptions, even huge ones', () => {
    const huge = 'x'.repeat(200_000)
    const text = calendar(
      'BEGIN:VEVENT',
      'UID:huge',
      'DTSTART;TZID=America/New_York:20260914T090000',
      'DTEND;TZID=America/New_York:20260914T100000',
      'SUMMARY:Planning',
      `DESCRIPTION:${huge}`,
      'X-ALT-DESC;FMTTYPE=text/html:<p>secret</p>',
      'END:VEVENT',
    )
    const events = eventsOn(text, '2026-09-14')
    expect(events).toHaveLength(1)
    expect(Object.keys(events[0]!).sort()).toEqual(['allDay', 'endAt', 'location', 'startAt', 'title'])
    expect(JSON.stringify(events)).not.toContain('xxxx')
    expect(JSON.stringify(events)).not.toContain('secret')
  })

  it('throws IcsParseError for text that is not a calendar', () => {
    const window = householdDayWindow(new Date('2026-09-14T16:00:00Z'), TZ)
    expect(() => parseIcsForDay('<html>Not found</html>', window.dayStartUtc, window.dayEndUtc, TZ)).toThrow(IcsParseError)
    expect(() => parseIcsForDay('', window.dayStartUtc, window.dayEndUtc, TZ)).toThrow(IcsParseError)
  })
})

describe('readIcsCalendarName', () => {
  it('returns X-WR-CALNAME when present', () => {
    expect(readIcsCalendarName(calendar())).toBe('Sam')
  })

  it('returns null when the calendar has no name', () => {
    expect(readIcsCalendarName(ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR'))).toBeNull()
  })

  it('throws IcsParseError for text that is not a calendar', () => {
    expect(() => readIcsCalendarName('BEGIN:VCARD\r\nEND:VCARD\r\n')).toThrow(IcsParseError)
    expect(() => readIcsCalendarName('hello')).toThrow(IcsParseError)
  })
})
