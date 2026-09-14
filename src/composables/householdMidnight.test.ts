import { describe, expect, it } from 'vitest'
import { msUntilNextHouseholdMidnight } from './householdMidnight'

const NY = 'America/New_York'

describe('msUntilNextHouseholdMidnight', () => {
  it('returns ms until the next local midnight on an ordinary day', () => {
    const now = new Date('2026-09-14T19:00:00Z') // 3pm EDT
    // Next local midnight: 2026-09-15 00:00 EDT (UTC-4) = 2026-09-15T04:00:00Z
    const expected = Date.parse('2026-09-15T04:00:00.000Z') - now.getTime()
    expect(msUntilNextHouseholdMidnight(now, NY)).toBe(expected)
  })

  it('returns exactly 0 right at local midnight', () => {
    const midnight = new Date('2026-09-15T04:00:00.000Z') // 2026-09-15 00:00 EDT
    // startOfHouseholdDay(midnight) is itself; "next" midnight is the following day.
    const expected = Date.parse('2026-09-16T04:00:00.000Z') - midnight.getTime()
    expect(msUntilNextHouseholdMidnight(midnight, NY)).toBe(expected)
  })

  it('handles the DST fall-back day, 2026-11-01, a 25-hour local day in America/New_York', () => {
    // Just after local midnight on Nov 1 (00:30 EDT, before the 2am fall-back).
    const now = new Date('2026-11-01T04:30:00Z')
    // Local midnight starting Nov 1 was EDT (UTC-4): 2026-11-01T04:00:00Z (matches
    // domain/time.test.ts's startOfHouseholdDay DST case). By Nov 2 the fall-back has
    // already happened, so its local midnight is EST (UTC-5): 2026-11-02T05:00:00Z.
    const expected = Date.parse('2026-11-02T05:00:00.000Z') - now.getTime()
    const ms = msUntilNextHouseholdMidnight(now, NY)
    expect(ms).toBe(expected)
    // Sanity: this local day is 25 hours long, not the usual 24.
    expect(ms).toBe(25 * 3_600_000 - 30 * 60_000)
  })

  it('handles the DST spring-forward day, 2026-03-08, a 23-hour local day in America/New_York', () => {
    // Just after local midnight on Mar 8 (00:30 EST, before the 2am spring-forward).
    const now = new Date('2026-03-08T05:30:00Z')
    // Local midnight starting Mar 8 is EST (UTC-5): 2026-03-08T05:00:00Z. By Mar 9 the
    // spring-forward has happened, so its local midnight is EDT (UTC-4): 2026-03-09T04:00:00Z.
    const expected = Date.parse('2026-03-09T04:00:00.000Z') - now.getTime()
    const ms = msUntilNextHouseholdMidnight(now, NY)
    expect(ms).toBe(expected)
    // Sanity: this local day is 23 hours long, not the usual 24.
    expect(ms).toBe(23 * 3_600_000 - 30 * 60_000)
  })
})
