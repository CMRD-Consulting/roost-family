import { describe, expect, it } from 'vitest'
import type { LogEntryRow, LogTable } from '@/data/settingsApi'
import {
  dayLabel, entryEditFormFrom, itemsOnDay, loadedDays, retentionCutoff, toEntryPatch, toLogItem, validateEntryEdit,
  validateVoidReason, zonedIso,
} from './logsModel'

const TZ = 'America/New_York'
const NOW = new Date('2026-09-14T19:00:00Z') // Monday 3:00 PM
const ctx = {
  medicines: [{ id: 'med-1', childId: 'theo', name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }],
  categories: [{ id: 'cat-1', name: 'Potty', iconKey: 'potty', sortOrder: 0 }],
  timeZone: TZ,
  now: NOW,
}

function row(table: LogTable, columns: Record<string, unknown>): LogEntryRow {
  const at = (columns.start_at ?? columns.at) as string
  return { id: columns.id as string, childId: columns.child_id as string, at, loggedByName: (columns.logged_by_name as string) ?? null, row: columns }
}

const sleepRow = row('sleep_entries', {
  id: 's1', child_id: 'theo', start_at: '2026-09-14T15:00:00Z', end_at: '2026-09-14T16:20:00Z', type: 'nap',
  sitter_session_id: null, logged_by_name: 'Sam',
})
const feedingRow = row('feeding_entries', {
  id: 'f1', child_id: 'theo', at: '2026-09-14T17:50:00Z', type: 'milk', amount: '6 oz', note: 'Fussy', sitter_session_id: null,
})
const doseRow = row('dose_entries', {
  id: 'd1', child_id: 'theo', medicine_id: 'med-1', at: '2026-09-14T17:00:00Z', logged_by_name: 'Alex', logged_offline: false,
  voided_at: '2026-09-14T18:00:00Z', void_reason: 'Logged twice', conflict_acknowledged_at: null, created_at: '2026-09-14T17:00:00Z',
  note: '2.5 ml', warnings_confirmed: [], sitter_session_id: null,
})

describe('toLogItem', () => {
  it('describes a sleep with its type, times and duration', () => {
    expect(toLogItem(sleepRow, 'sleep_entries', ctx)).toMatchObject({
      id: 's1', table: 'sleep_entries', childId: 'theo', at: '2026-09-14T15:00:00Z', loggedByName: 'Sam',
      title: 'Nap', detail: '11:00 AM–12:20 PM · 1h 20m', editable: true, voided: false, voidReason: null,
    })
    const ongoing = row('sleep_entries', { ...sleepRow.row, end_at: null, type: 'night' })
    expect(toLogItem(ongoing, 'sleep_entries', ctx)).toMatchObject({ title: 'Night sleep', detail: 'Still asleep' })
  })

  it('describes a feeding with its amount and note', () => {
    expect(toLogItem(feedingRow, 'feeding_entries', ctx)).toMatchObject({ title: 'Milk', detail: '6 oz · Fussy', editable: true })
  })

  it('names a dose by its medicine, never editable, and carries the void reason', () => {
    expect(toLogItem(doseRow, 'dose_entries', ctx)).toMatchObject({
      title: 'Infant ibuprofen', detail: '2.5 ml', editable: false, voided: true, voidReason: 'Logged twice', loggedByName: 'Alex',
    })
    const archived = row('dose_entries', { ...doseRow.row, medicine_id: 'gone' })
    expect(toLogItem(archived, 'dose_entries', ctx)!.title).toBe('Medicine')
  })

  it('names stickers by category and diapers by kind', () => {
    const sticker = row('sticker_entries', { id: 'k1', child_id: 'ivy', category_id: 'cat-1', at: '2026-09-14T12:00:00Z', sitter_session_id: null })
    expect(toLogItem(sticker, 'sticker_entries', ctx)).toMatchObject({ title: 'Potty sticker', detail: null })
    const diaper = row('diaper_entries', { id: 'p1', child_id: 'theo', at: '2026-09-14T12:00:00Z', kind: 'both', sitter_session_id: null })
    expect(toLogItem(diaper, 'diaper_entries', ctx)).toMatchObject({ title: 'Wet and dirty diaper' })
  })

  it('skips a row it cannot read', () => {
    expect(toLogItem(row('sleep_entries', { ...sleepRow.row, type: 'weird' }), 'sleep_entries', ctx)).toBeNull()
  })
})

describe('days', () => {
  const items = [sleepRow, feedingRow].map((r, i) => toLogItem(r, i === 0 ? 'sleep_entries' : 'feeding_entries', ctx)!)
  const lateLastNight = toLogItem(row('feeding_entries', { ...feedingRow.row, id: 'f2', at: '2026-09-14T03:30:00Z' }), 'feeding_entries', ctx)!

  it('keeps the items on one household day', () => {
    expect(itemsOnDay([...items, lateLastNight], '2026-09-14', TZ).map((i) => i.id)).toEqual(['s1', 'f1'])
    // 03:30 UTC is 11:30 PM on the 13th in New York.
    expect(itemsOnDay([...items, lateLastNight], '2026-09-13', TZ).map((i) => i.id)).toEqual(['f2'])
  })

  it('lists the distinct loaded days, newest first', () => {
    expect(loadedDays([lateLastNight, ...items], TZ)).toEqual(['2026-09-14', '2026-09-13'])
  })

  it('labels today, yesterday and other days', () => {
    expect(dayLabel('2026-09-14', '2026-09-14')).toBe('Today')
    expect(dayLabel('2026-09-13', '2026-09-14')).toBe('Yesterday')
    expect(dayLabel('2026-09-07', '2026-09-14')).toBe('Mon, Sep 7')
  })
})

describe('zonedIso', () => {
  it('turns a household date and wall-clock time into a UTC timestamp', () => {
    expect(zonedIso('2026-09-14', '11:05', TZ)).toBe('2026-09-14T15:05:00.000Z')
    expect(zonedIso('2026-01-14', '11:05', TZ)).toBe('2026-01-14T16:05:00.000Z')
  })
})

describe('editing an entry', () => {
  const sleep = toLogItem(sleepRow, 'sleep_entries', ctx)!
  const feeding = toLogItem(feedingRow, 'feeding_entries', ctx)!

  it('fills the form in household time', () => {
    expect(entryEditFormFrom(sleep, TZ)).toMatchObject({
      date: '2026-09-14', time: '11:00', hasEnd: true, endDate: '2026-09-14', endTime: '12:20',
    })
    expect(entryEditFormFrom(feeding, TZ)).toMatchObject({ date: '2026-09-14', time: '13:50', type: 'milk', amount: '6 oz' })
  })

  it('patches a sleep with its start and end', () => {
    const form = { ...entryEditFormFrom(sleep, TZ), time: '10:30', endTime: '12:00' }
    expect(validateEntryEdit(sleep, form, TZ, NOW)).toEqual({})
    expect(toEntryPatch(sleep, form, TZ)).toEqual({ startAt: '2026-09-14T14:30:00.000Z', endAt: '2026-09-14T16:00:00.000Z' })
  })

  it('patches a feeding with its time, type and amount (blank amount clears it)', () => {
    const form = { ...entryEditFormFrom(feeding, TZ), time: '13:00', type: 'meal' as const, amount: '  ' }
    expect(toEntryPatch(feeding, form, TZ)).toEqual({ at: '2026-09-14T17:00:00.000Z', type: 'meal', amount: null })
  })

  it('patches a diaper with its kind and a sticker with only its time', () => {
    const diaper = toLogItem(row('diaper_entries', { id: 'p1', child_id: 'theo', at: '2026-09-14T12:00:00Z', kind: 'wet', sitter_session_id: null }), 'diaper_entries', ctx)!
    expect(toEntryPatch(diaper, { ...entryEditFormFrom(diaper, TZ), kind: 'dirty' }, TZ)).toEqual({ at: '2026-09-14T12:00:00.000Z', kind: 'dirty' })
    const sticker = toLogItem(row('sticker_entries', { id: 'k1', child_id: 'ivy', category_id: 'cat-1', at: '2026-09-14T12:00:00Z', sitter_session_id: null }), 'sticker_entries', ctx)!
    expect(toEntryPatch(sticker, entryEditFormFrom(sticker, TZ), TZ)).toEqual({ at: '2026-09-14T12:00:00.000Z' })
  })

  it('rejects a time in the future, an end before the start and an amount over 20 characters', () => {
    expect(validateEntryEdit(feeding, { ...entryEditFormFrom(feeding, TZ), time: '16:00' }, TZ, NOW)).toEqual({
      time: 'That time hasn’t happened yet.',
    })
    expect(validateEntryEdit(sleep, { ...entryEditFormFrom(sleep, TZ), endTime: '10:00' }, TZ, NOW)).toEqual({
      end: 'The end must be after the start.',
    })
    expect(validateEntryEdit(feeding, { ...entryEditFormFrom(feeding, TZ), amount: 'x'.repeat(21) }, TZ, NOW)).toEqual({
      amount: 'Amounts can be up to 20 characters.',
    })
    expect(validateEntryEdit(feeding, { ...entryEditFormFrom(feeding, TZ), time: '' }, TZ, NOW)).toEqual({ time: 'Pick a date and time.' })
  })
})

describe('validateVoidReason', () => {
  it('requires 1 to 200 characters', () => {
    expect(validateVoidReason('  ')).toBe('Say why this dose is being voided.')
    expect(validateVoidReason('x'.repeat(201))).toBe('Reasons can be up to 200 characters.')
    expect(validateVoidReason('Logged twice')).toBeNull()
  })
})

describe('retentionCutoff', () => {
  /** The server's own check (delete_old_entries): the cutoff must not be after now() - interval '2 years', which
   *  Postgres clamps Feb 29 to Feb 28. */
  function serverLimit(now: Date): number {
    const d = new Date(now)
    const month = d.getUTCMonth()
    d.setUTCFullYear(d.getUTCFullYear() - 2)
    if (d.getUTCMonth() !== month) d.setUTCDate(0)
    return d.getTime()
  }

  it('is the start of the household day two years ago, less a day of safety margin', () => {
    expect(retentionCutoff(NOW, TZ)).toBe('2024-09-13T04:00:00.000Z')
    expect(Date.parse(retentionCutoff(NOW, TZ))).toBeLessThanOrEqual(serverLimit(NOW))
  })

  it('clamps Feb 29 to Feb 28 two years back (no rollover to Mar 1 the server would reject)', () => {
    const leapDay = new Date('2028-02-29T15:00:00Z') // 10:00 AM in New York
    expect(retentionCutoff(leapDay, TZ)).toBe('2026-02-27T05:00:00.000Z')
    expect(Date.parse(retentionCutoff(leapDay, TZ))).toBeLessThanOrEqual(serverLimit(leapDay))
  })

  it('stays before the server limit just after midnight in a time zone behind UTC', () => {
    const lateUtc = new Date('2028-03-01T04:30:00Z') // Feb 29, 11:30 PM in New York
    expect(retentionCutoff(lateUtc, TZ)).toBe('2026-02-27T05:00:00.000Z')
    expect(Date.parse(retentionCutoff(lateUtc, TZ))).toBeLessThanOrEqual(serverLimit(lateUtc))
  })
})
