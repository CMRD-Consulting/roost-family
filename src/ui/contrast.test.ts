import { describe, it, expect } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'
import { TOKENS } from './tokens'

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  })
  it('is 1 for identical colors', () => {
    expect(contrastRatio('#A84B24', '#A84B24')).toBeCloseTo(1, 5)
  })
  it('is symmetric', () => {
    expect(contrastRatio('#A84B24', '#FBF6EE')).toBeCloseTo(contrastRatio('#FBF6EE', '#A84B24'), 10)
  })
})

// These pairs mirror the deep-text-on-neutral combinations used across the app
// (see src/styles/app.css — the two files must be kept in sync by hand).
describe('token contrast (WCAG AA normal text, >= 4.5:1)', () => {
  it('orange-deep passes on both surface and app backgrounds', () => {
    expect(contrastRatio(TOKENS.surface, TOKENS.orangeDeep)).toBeGreaterThanOrEqual(4.6)
    expect(contrastRatio(TOKENS.orangeDeep, TOKENS.app)).toBeGreaterThanOrEqual(4.6)
  })

  it('green-deep passes on both surface and app backgrounds', () => {
    expect(contrastRatio(TOKENS.greenDeep, TOKENS.app)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.greenDeep, TOKENS.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('amber-deep passes on both surface and app backgrounds', () => {
    expect(contrastRatio(TOKENS.amberDeep, TOKENS.app)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.amberDeep, TOKENS.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('warn-ink passes with surface text', () => {
    expect(contrastRatio(TOKENS.warnInk, TOKENS.surface)).toBeGreaterThanOrEqual(4.5)
  })
})
