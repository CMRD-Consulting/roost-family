import { describe, it, expect } from 'vitest'
import { ageInMonths, isFeatureEnabled } from './ageDefaults'

const today = '2026-09-14'
const ctx = (birthday: string, over: Partial<Parameters<typeof isFeatureEnabled>[1]> = {}) => ({
  birthday,
  today,
  overrides: {},
  diaperLogEnabled: false,
  ...over,
})

describe('ageInMonths', () => {
  it('counts whole months', () => {
    expect(ageInMonths('2025-05-24', today)).toBe(15) // Mara
    expect(ageInMonths('2023-05-23', today)).toBe(39) // Leona
  })
  it('does not count a month until the day is reached', () => {
    expect(ageInMonths('2023-09-14', '2026-09-14')).toBe(36)
    expect(ageInMonths('2023-09-14', '2026-09-13')).toBe(35)
  })
  it('allows a future birthday, returning a negative age', () => {
    expect(ageInMonths('2027-01-01', today)).toBeLessThan(0)
  })
  it('rejects a month outside 1-12', () => {
    expect(() => ageInMonths('2025-00-10', today)).toThrow()
    expect(() => ageInMonths('2025-13-10', today)).toThrow()
  })
  it('rejects a day outside 1-31', () => {
    expect(() => ageInMonths('2025-05-00', today)).toThrow()
    expect(() => ageInMonths('2025-05-32', today)).toThrow()
  })
  it('rejects a non-numeric date', () => {
    expect(() => ageInMonths('2025-XX-10', today)).toThrow()
    expect(() => ageInMonths('not-a-date', today)).toThrow()
  })
})

describe('isFeatureEnabled', () => {
  it('gives a 1-year-old the wake window and feeding but not Kids Corner', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2025-05-24'))).toBe(true)
    expect(isFeatureEnabled('feeding', ctx('2025-05-24'))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2025-05-24'))).toBe(false)
  })

  it('gives a 3-year-old Kids Corner but not the wake window', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-05-23'))).toBe(false)
    expect(isFeatureEnabled('kidsCorner', ctx('2023-05-23'))).toBe(true)
  })

  it('switches on the birthday', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-09-14'))).toBe(false)
    expect(isFeatureEnabled('wakeWindow', { ...ctx('2023-09-14'), today: '2026-09-13' })).toBe(true)
  })

  it('keeps Kids Corner through age 7 and drops it at 8', () => {
    expect(isFeatureEnabled('kidsCorner', ctx('2019-09-14'))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2018-09-14'))).toBe(false)
  })

  it('lets an override win', () => {
    expect(isFeatureEnabled('wakeWindow', ctx('2023-05-23', { overrides: { wakeWindow: true } }))).toBe(true)
    expect(isFeatureEnabled('kidsCorner', ctx('2023-05-23', { overrides: { kidsCorner: false } }))).toBe(false)
  })

  it('requires the household diaper toggle', () => {
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { overrides: { diaper: true } }))).toBe(false)
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { diaperLogEnabled: true }))).toBe(true)
    expect(isFeatureEnabled('diaper', ctx('2025-05-24', { diaperLogEnabled: true, overrides: { diaper: false } }))).toBe(false)
  })
})
