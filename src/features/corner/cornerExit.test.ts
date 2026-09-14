import { describe, expect, it } from 'vitest'
import { cornerLeaveAllowed, PATTERN_WINDOW_MS, patternDots, seededRng, startPattern, tapPatternDot } from './cornerExit'

describe('cornerLeaveAllowed', () => {
  const base = { authorizedExit: false, displayKind: 'registered' as const }

  it('blocks leaving the Corner (e.g. history back to /home) without an authorized exit', () => {
    expect(cornerLeaveAllowed({ path: '/home' }, base)).toBe(false)
    expect(cornerLeaveAllowed({ path: '/offline' }, base)).toBe(false)
  })

  it('allows it once the PIN or the offline pattern has authorized the exit', () => {
    expect(cornerLeaveAllowed({ path: '/home' }, { ...base, authorizedExit: true })).toBe(true)
  })

  it('always lets display state changes through: removed, unregistered, back to setup', () => {
    for (const path of ['/removed', '/', '/setup']) expect(cornerLeaveAllowed({ path }, base)).toBe(true)
    // "/" redirects to /home before guards run, so an unregistered or revoked display is let through by its state.
    expect(cornerLeaveAllowed({ path: '/home' }, { ...base, displayKind: 'unregistered' })).toBe(true)
    expect(cornerLeaveAllowed({ path: '/home' }, { ...base, displayKind: 'revoked' })).toBe(true)
  })
})

describe('patternDots', () => {
  it('places dots 1-4 in four different cells, inside the area, the same way for the same seed', () => {
    const a = patternDots(seededRng(42))
    const b = patternDots(seededRng(42))
    expect(a).toEqual(b)
    expect(a.map((d) => d.n)).toEqual([1, 2, 3, 4])
    expect(new Set(a.map((d) => `${d.col},${d.row}`)).size).toBe(4)
    for (const d of a) {
      expect(d.x).toBeGreaterThanOrEqual(0)
      expect(d.x).toBeLessThanOrEqual(100)
      expect(d.y).toBeGreaterThanOrEqual(0)
      expect(d.y).toBeLessThanOrEqual(100)
    }
  })

  it('moves the dots for a different seed', () => {
    expect(patternDots(seededRng(1))).not.toEqual(patternDots(seededRng(2)))
  })

  it('works with an rng that returns its extremes', () => {
    expect(new Set(patternDots(() => 0).map((d) => `${d.col},${d.row}`)).size).toBe(4)
    expect(new Set(patternDots(() => 0.999999).map((d) => `${d.col},${d.row}`)).size).toBe(4)
  })
})

describe('tapPatternDot', () => {
  it('completes when 1, 2, 3, 4 are tapped in order within 10 seconds of the first tap', () => {
    let s = startPattern()
    let done = false
    for (const [n, at] of [[1, 0], [2, 1_000], [3, 5_000], [4, PATTERN_WINDOW_MS]] as const) {
      const r = tapPatternDot(s, n, at)
      s = r.state
      done = r.complete
    }
    expect(done).toBe(true)
  })

  it('resets on a tap out of order', () => {
    let s = tapPatternDot(startPattern(), 1, 0).state
    s = tapPatternDot(s, 2, 100).state
    const wrong = tapPatternDot(s, 4, 200)
    expect(wrong.complete).toBe(false)
    expect(wrong.state).toEqual(startPattern())
  })

  it('a wrong first tap stays reset, and tapping 1 after a wrong tap starts over', () => {
    const wrong = tapPatternDot(startPattern(), 3, 0)
    expect(wrong.state).toEqual(startPattern())
    const r = tapPatternDot(tapPatternDot(startPattern(), 1, 0).state, 1, 50)
    expect(r.state.next).toBe(2)
    expect(r.state.startedAt).toBe(50)
  })

  it('resets when the sequence takes longer than 10 seconds', () => {
    let s = tapPatternDot(startPattern(), 1, 0).state
    s = tapPatternDot(s, 2, 1_000).state
    s = tapPatternDot(s, 3, 2_000).state
    const late = tapPatternDot(s, 4, PATTERN_WINDOW_MS + 1)
    expect(late.complete).toBe(false)
    expect(late.state).toEqual(startPattern())
  })
})
