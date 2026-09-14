import { describe, expect, it } from 'vitest'
import { nextShown, nightSeed, shuffledOrder, slotAt, SLIDE_MS } from './slideshow'

const IDS = Array.from({ length: 12 }, (_, i) => `photo-${String(i).padStart(2, '0')}`)

describe('shuffledOrder', () => {
  it('is a permutation of the ids', () => {
    const order = shuffledOrder(IDS, '2026-09-14')
    expect([...order].sort()).toEqual(IDS)
  })

  it('is stable for the same night, whatever order the ids arrive in', () => {
    const reversed = [...IDS].reverse()
    expect(shuffledOrder(reversed, '2026-09-14')).toEqual(shuffledOrder(IDS, '2026-09-14'))
  })

  it('differs from night to night (and is not just the sorted order)', () => {
    const a = shuffledOrder(IDS, '2026-09-14')
    const b = shuffledOrder(IDS, '2026-09-15')
    expect(a).not.toEqual(b)
    expect(a).not.toEqual(IDS)
  })

  it('handles no photos and one photo', () => {
    expect(shuffledOrder([], 'x')).toEqual([])
    expect(shuffledOrder(['only'], 'x')).toEqual(['only'])
  })
})

describe('nightSeed', () => {
  const tz = 'America/New_York'

  it('is the same household date from the evening through the next morning', () => {
    // 8 PM and 11:59 PM on Monday, 5:59 AM on Tuesday (EDT) all belong to Monday's night.
    expect(nightSeed(new Date('2026-09-15T00:00:00Z'), tz)).toBe('2026-09-14')
    expect(nightSeed(new Date('2026-09-15T03:59:00Z'), tz)).toBe('2026-09-14')
    expect(nightSeed(new Date('2026-09-15T09:59:00Z'), tz)).toBe('2026-09-14')
  })

  it('moves to the next night the following evening', () => {
    expect(nightSeed(new Date('2026-09-16T00:00:00Z'), tz)).toBe('2026-09-15')
  })
})

describe('slotAt', () => {
  it('advances once a minute', () => {
    const t = Date.parse('2026-09-15T01:00:00Z')
    expect(slotAt(t + SLIDE_MS - 1)).toBe(slotAt(t))
    expect(slotAt(t + SLIDE_MS)).toBe(slotAt(t) + 1)
  })
})

describe('nextShown', () => {
  const order = ['a', 'b', 'c', 'd']

  it('picks the photo for the slot, wrapping around the order', () => {
    const loaded = new Set(order)
    expect(nextShown(order, 1, loaded)).toBe('b')
    expect(nextShown(order, 6, loaded)).toBe('c')
  })

  it('skips photos that have not loaded (offline, deleted, failed) to the next loaded one', () => {
    expect(nextShown(order, 1, new Set(['a', 'd']))).toBe('d')
    expect(nextShown(order, 3, new Set(['a']))).toBe('a')
  })

  it('is null when nothing has loaded or there are no photos', () => {
    expect(nextShown(order, 0, new Set())).toBeNull()
    expect(nextShown([], 0, new Set(['a']))).toBeNull()
  })
})
