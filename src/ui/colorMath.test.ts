import { describe, it, expect } from 'vitest'
import { deltaE2000, hexToLab, hexDeltaE2000, simulateCvd, hexToRgb, rgbToHex, srgbToLinear, linearToSrgb } from './colorMath'

describe('sRGB <-> linear round-trip', () => {
  it('round-trips 8-bit channel values', () => {
    for (const v of [0, 1, 16, 128, 200, 255]) {
      expect(Math.round(linearToSrgb(srgbToLinear(v)))).toBe(v)
    }
  })
  it('hex <-> rgb round-trips', () => {
    expect(hexToRgb('#A84B24')).toEqual([0xa8, 0x4b, 0x24])
    expect(rgbToHex([0xa8, 0x4b, 0x24])).toBe('#A84B24')
  })
})

describe('hexToLab', () => {
  it('maps white and black to the expected L*', () => {
    expect(hexToLab('#FFFFFF').L).toBeCloseTo(100, 0)
    expect(hexToLab('#000000').L).toBeCloseTo(0, 0)
  })
})

describe('deltaE2000', () => {
  // Reference pair from Sharma, Wu & Dua (2005) — the canonical worked example
  // used to validate CIEDE2000 implementations.
  it('matches the published Sharma test pair (~2.0425)', () => {
    const lab1 = { L: 50, a: 2.6772, b: -79.7751 }
    const lab2 = { L: 50, a: 0, b: -82.7485 }
    expect(deltaE2000(lab1, lab2)).toBeCloseTo(2.0425, 3)
  })

  it('is 0 for identical colors', () => {
    const lab = hexToLab('#5B6ACF')
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 6)
  })

  it('is symmetric', () => {
    const a = hexToLab('#5B6ACF')
    const b = hexToLab('#C2477A')
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 10)
  })
})

describe('hexDeltaE2000', () => {
  it('is a thin wrapper matching deltaE2000(hexToLab(...))', () => {
    expect(hexDeltaE2000('#5B6ACF', '#C2477A')).toBeCloseTo(deltaE2000(hexToLab('#5B6ACF'), hexToLab('#C2477A')), 10)
  })
})

describe('simulateCvd', () => {
  it('leaves grayscale colors unchanged (no chroma to confuse)', () => {
    // Grayscale R=G=B is a fixed point of both Machado matrices.
    expect(simulateCvd('#808080', 'protan')).toBe('#808080')
    expect(simulateCvd('#808080', 'deutan')).toBe('#808080')
  })

  it('collapses a strongly red/green hue difference under both deficiencies', () => {
    const red = hexDeltaE2000(simulateCvd('#FF0000', 'protan'), simulateCvd('#00FF00', 'protan'))
    const normal = hexDeltaE2000('#FF0000', '#00FF00')
    expect(red).toBeLessThan(normal)
  })
})
