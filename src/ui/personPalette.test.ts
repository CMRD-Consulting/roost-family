import { describe, it, expect } from 'vitest'
import { PERSON_COLORS, PERSON_COLOR_NAMES, LOG_BUTTON_COLORS, personColor, personColorName } from './personPalette'
import { contrastRatio } from './contrast'
import { hexDeltaE2000, simulateCvd } from './colorMath'

describe('person palette', () => {
  it('has 10 colors', () => {
    expect(PERSON_COLORS).toHaveLength(10)
  })

  it('names every color, in order', () => {
    expect(PERSON_COLOR_NAMES).toHaveLength(PERSON_COLORS.length)
    expect(new Set(PERSON_COLOR_NAMES).size).toBe(PERSON_COLOR_NAMES.length)
    expect(personColorName(PERSON_COLORS[1])).toBe('Teal')
    expect(personColorName(PERSON_COLORS[1].toLowerCase())).toBe('Teal')
    expect(personColorName('#123456')).toBe('#123456')
  })

  it('shares no color with log buttons', () => {
    const logs = new Set(Object.values(LOG_BUTTON_COLORS).map((c) => c.toLowerCase()))
    for (const c of PERSON_COLORS) expect(logs.has(c.toLowerCase())).toBe(false)
  })

  it('repeats after 10 people', () => {
    expect(personColor(0)).toBe(PERSON_COLORS[0])
    expect(personColor(10)).toBe(PERSON_COLORS[0])
    expect(personColor(13)).toBe(PERSON_COLORS[3])
  })

  it('gives white initials at least 4.5:1 contrast on every color', () => {
    for (const c of PERSON_COLORS) {
      expect(contrastRatio('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('stays at least ΔE 15 away from every log-button color', () => {
    const logs = Object.values(LOG_BUTTON_COLORS)
    let min = Infinity
    for (const c of PERSON_COLORS) {
      for (const l of logs) min = Math.min(min, hexDeltaE2000(c, l))
    }
    expect(min).toBeGreaterThanOrEqual(15)
  })

  it('keeps every pair at least ΔE 12 apart under normal vision', () => {
    let min = Infinity
    for (let i = 0; i < PERSON_COLORS.length; i++) {
      for (let j = i + 1; j < PERSON_COLORS.length; j++) {
        min = Math.min(min, hexDeltaE2000(PERSON_COLORS[i]!, PERSON_COLORS[j]!))
      }
    }
    expect(min).toBeGreaterThanOrEqual(12)
  })

  it('keeps every pair at least ΔE 6 apart under simulated protanopia and deuteranopia', () => {
    const protan = PERSON_COLORS.map((c) => simulateCvd(c, 'protan'))
    const deutan = PERSON_COLORS.map((c) => simulateCvd(c, 'deutan'))
    let minProtan = Infinity
    let minDeutan = Infinity
    for (let i = 0; i < PERSON_COLORS.length; i++) {
      for (let j = i + 1; j < PERSON_COLORS.length; j++) {
        minProtan = Math.min(minProtan, hexDeltaE2000(protan[i]!, protan[j]!))
        minDeutan = Math.min(minDeutan, hexDeltaE2000(deutan[i]!, deutan[j]!))
      }
    }
    expect(minProtan).toBeGreaterThanOrEqual(6)
    expect(minDeutan).toBeGreaterThanOrEqual(6)
  })
})
