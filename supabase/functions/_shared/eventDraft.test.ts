import { describe, expect, it } from 'vitest'
import {
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
  EventInputError,
  householdDateOf,
  midnightOf,
  parseEventDraft,
  shiftDate,
  wallClockOf,
} from './eventDraft'

const NY = 'America/New_York'
const NOW = new Date('2026-10-19T18:00:00.000Z')

const timed = (over: Record<string, unknown> = {}) => ({
  title: 'Swim lesson',
  allDay: false,
  start: '2026-10-19T20:00:00Z',
  end: '2026-10-19T20:45:00Z',
  ...over,
})

const allDay = (over: Record<string, unknown> = {}) => ({
  title: 'Library books due',
  allDay: true,
  start: '2026-10-20',
  end: '2026-10-21',
  ...over,
})

const refuses = (input: Record<string, unknown>, zone = NY) => {
  expect(() => parseEventDraft(input, zone, NOW)).toThrow(EventInputError)
}

describe('parseEventDraft', () => {
  it('reads a timed event as instants and names its household dates', () => {
    const draft = parseEventDraft(timed({ location: 'YMCA Pool' }), NY, NOW)
    expect(draft).toMatchObject({
      title: 'Swim lesson',
      location: 'YMCA Pool',
      allDay: false,
      startDate: '2026-10-19',
      endDate: '2026-10-19',
      timeZone: NY,
    })
    expect(draft.startAt.toISOString()).toBe('2026-10-19T20:00:00.000Z')
    expect(draft.endAt.toISOString()).toBe('2026-10-19T20:45:00.000Z')
  })

  it('reads an all-day event as household dates and their midnights', () => {
    const draft = parseEventDraft(allDay(), NY, NOW)
    expect(draft.startDate).toBe('2026-10-20')
    expect(draft.endDate).toBe('2026-10-21')
    // Midnight in New York, not UTC.
    expect(draft.startAt.toISOString()).toBe('2026-10-20T04:00:00.000Z')
    expect(draft.endAt.toISOString()).toBe('2026-10-21T04:00:00.000Z')
  })

  it('keeps the instant but reads the date in the household zone', () => {
    // 00:30 UTC on the 20th is still the evening of the 19th in New York.
    const draft = parseEventDraft(timed({ start: '2026-10-20T00:30:00Z', end: '2026-10-20T01:00:00Z' }), NY, NOW)
    expect(draft.startDate).toBe('2026-10-19')
  })

  it('collapses whitespace in the title and location, and drops an empty location', () => {
    const draft = parseEventDraft(timed({ title: '  Swim   lesson \n', location: '   ' }), NY, NOW)
    expect(draft.title).toBe('Swim lesson')
    expect(draft.location).toBeNull()
  })

  it('treats a missing or null location as none', () => {
    expect(parseEventDraft(timed(), NY, NOW).location).toBeNull()
    expect(parseEventDraft(timed({ location: null }), NY, NOW).location).toBeNull()
  })

  it('refuses a title that is missing, blank, over-long, marked up or has control characters', () => {
    refuses(timed({ title: undefined }))
    refuses(timed({ title: 42 }))
    refuses(timed({ title: '   ' }))
    refuses(timed({ title: 'x'.repeat(EVENT_TITLE_MAX + 1) }))
    refuses(timed({ title: '<b>Swim</b>' }))
    refuses(timed({ title: 'Swim\u0000lesson' }))
  })

  it('accepts a title and location exactly at the cap', () => {
    const draft = parseEventDraft(timed({ title: 'x'.repeat(EVENT_TITLE_MAX), location: 'y'.repeat(EVENT_LOCATION_MAX) }), NY, NOW)
    expect(draft.title).toHaveLength(EVENT_TITLE_MAX)
    expect(draft.location).toHaveLength(EVENT_LOCATION_MAX)
  })

  it('refuses an over-long or marked-up location', () => {
    refuses(timed({ location: 'y'.repeat(EVENT_LOCATION_MAX + 1) }))
    refuses(timed({ location: '<script>' }))
    refuses(timed({ location: 7 }))
  })

  it('refuses an allDay that is not a boolean', () => {
    refuses(timed({ allDay: 'yes' }))
    refuses(timed({ allDay: undefined }))
  })

  it('refuses times without a zone, in the wrong shape, or not real', () => {
    refuses(timed({ start: '2026-10-19T20:00:00' }))
    refuses(timed({ start: 'tomorrow at noon' }))
    refuses(timed({ start: '2026-10-19' }))
    refuses(timed({ end: 1_790_000_000_000 }))
    refuses(allDay({ start: '2026-02-30' }))
    refuses(allDay({ start: '2026-13-01' }))
    refuses(allDay({ start: '26-10-20' }))
  })

  it('refuses an end that is not after the start', () => {
    refuses(timed({ end: '2026-10-19T20:00:00Z' }))
    refuses(timed({ end: '2026-10-19T19:00:00Z' }))
    refuses(allDay({ end: '2026-10-20' }))
    refuses(allDay({ end: '2026-10-19' }))
  })

  it('refuses an event longer than a month or further out than about a year', () => {
    refuses(allDay({ start: '2026-10-20', end: '2026-12-20' }))
    refuses(timed({ start: '2028-01-01T10:00:00Z', end: '2028-01-01T11:00:00Z' }))
    refuses(timed({ start: '2024-01-01T10:00:00Z', end: '2024-01-01T11:00:00Z' }))
  })

  it('accepts an event just inside the horizon', () => {
    const draft = parseEventDraft(timed({ start: '2027-10-01T10:00:00Z', end: '2027-10-01T11:00:00Z' }), NY, NOW)
    expect(draft.allDay).toBe(false)
  })

  it('falls back to UTC for a time zone the runtime does not know', () => {
    expect(parseEventDraft(allDay(), 'Mars/Olympus', NOW).timeZone).toBe('UTC')
    expect(parseEventDraft(allDay(), 'Mars/Olympus', NOW).startAt.toISOString()).toBe('2026-10-20T00:00:00.000Z')
  })
})

describe('household date and clock helpers', () => {
  it('names the household date and wall clock of an instant', () => {
    expect(householdDateOf(new Date('2026-10-20T01:30:00Z'), NY)).toBe('2026-10-19')
    expect(wallClockOf(new Date('2026-10-20T01:30:00Z'), NY)).toBe('2026-10-19T21:30:00')
    expect(wallClockOf(new Date('2026-10-20T01:30:00Z'), 'UTC')).toBe('2026-10-20T01:30:00')
  })

  it('finds midnight in the household zone, including across a DST change', () => {
    expect(midnightOf('2026-10-20', NY).toISOString()).toBe('2026-10-20T04:00:00.000Z')
    // The Sunday the US falls back: midnight is still EDT (−04:00).
    expect(midnightOf('2026-11-01', NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(midnightOf('2026-11-02', NY).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })

  it('shifts a date by whole days across month and year ends', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2026-11-01', 1)).toBe('2026-11-02')
  })
})
