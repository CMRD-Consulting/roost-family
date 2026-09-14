import { describe, it, expect } from 'vitest'
import { weekStartDate, stickerWeek } from './stickers'
import type { StickerEntry } from './types'

const NY = 'America/New_York'
const s = (at: string, categoryId = 'potty', childId = 'leona'): StickerEntry => ({ id: crypto.randomUUID(), childId, categoryId, at, sitterSessionId: null })

describe('weekStartDate', () => {
  it('returns the Monday of the household week', () => {
    expect(weekStartDate(new Date('2026-09-16T15:00:00Z'), NY)).toBe('2026-09-14') // Wednesday
    expect(weekStartDate(new Date('2026-09-21T02:00:00Z'), NY)).toBe('2026-09-14') // Sunday 22:00 local
    expect(weekStartDate(new Date('2026-09-14T13:00:00Z'), NY)).toBe('2026-09-14') // Monday
  })
})

describe('stickerWeek', () => {
  it('counts stickers per category per weekday (Mon=0 … Sun=6)', () => {
    const now = new Date('2026-09-20T20:00:00Z') // Sunday afternoon
    const week = stickerWeek(
      [
        s('2026-09-14T13:00:00Z'), // Mon
        s('2026-09-14T15:00:00Z'), // Mon
        s('2026-09-16T15:00:00Z', 'teeth'), // Wed
        s('2026-09-21T03:30:00Z'), // Sun 23:30 local
        s('2026-09-13T15:00:00Z'), // previous Sunday — excluded
        s('2026-09-15T15:00:00Z', 'potty', 'mara'), // other child — excluded
        s('2026-09-15T15:00:00Z', 'unknown'), // unknown category — excluded
      ],
      'leona',
      ['potty', 'teeth'],
      now,
      NY,
    )
    expect(week).toEqual({
      weekStart: '2026-09-14',
      counts: { potty: [2, 0, 0, 0, 0, 0, 1], teeth: [0, 0, 1, 0, 0, 0, 0] },
    })
  })
})
