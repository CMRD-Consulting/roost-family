import { describe, it, expect } from 'vitest'
import { PERSON_COLORS, LOG_BUTTON_COLORS, personColor } from './personPalette'

describe('person palette', () => {
  it('has 10 colors', () => {
    expect(PERSON_COLORS).toHaveLength(10)
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
})
