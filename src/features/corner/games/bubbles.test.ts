import { describe, expect, it } from 'vitest'
import { BUBBLE_COUNT, initialBubbles, replaceBubble, spawnBubble, stepBubbles, swayedX, type Rng } from './bubbles'

/** A deterministic rng (mulberry32). */
function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('bubbles model', () => {
  it('starts with six bubbles on screen, each a comfortable touch target', () => {
    const bubbles = initialBubbles(seeded(1))
    expect(bubbles).toHaveLength(BUBBLE_COUNT)
    expect(new Set(bubbles.map((b) => b.id)).size).toBe(BUBBLE_COUNT)
    for (const b of bubbles) {
      expect(b.x).toBeGreaterThanOrEqual(12)
      expect(b.x).toBeLessThanOrEqual(88)
      expect(b.y).toBeGreaterThanOrEqual(12)
      expect(b.y).toBeLessThanOrEqual(88)
      expect(b.size).toBeGreaterThanOrEqual(110)
      expect(b.size).toBeLessThanOrEqual(180)
    }
  })

  it('a bubble spawned off screen waits below the bottom edge', () => {
    expect(spawnBubble(seeded(2), 9, false).y).toBeGreaterThan(100)
  })

  it('stepping drifts every bubble upward by its speed', () => {
    const before = initialBubbles(seeded(3))
    const { bubbles: after, nextId } = stepBubbles(before, 1000, seeded(4), 7)
    expect(nextId).toBe(7)
    after.forEach((b, i) => {
      expect(b.id).toBe(before[i]!.id)
      expect(b.y).toBeCloseTo(before[i]!.y - before[i]!.speed, 5)
    })
  })

  it('a bubble that has risen off the top comes back as a new one from below', () => {
    const rng = seeded(5)
    const gone = { ...spawnBubble(rng, 1, true), y: -17.9, speed: 10 }
    const { bubbles, nextId } = stepBubbles([gone], 100, rng, 2)
    expect(nextId).toBe(3)
    expect(bubbles[0]!.id).toBe(2)
    expect(bubbles[0]!.y).toBeGreaterThan(100)
  })

  it('sway keeps the drawn x within the play area', () => {
    const rng = seeded(6)
    for (let i = 0; i < 50; i++) {
      const b = spawnBubble(rng, i, true)
      for (const y of [-18, 0, 50, 100, 118]) {
        const x = swayedX({ ...b, y })
        expect(x).toBeGreaterThan(5)
        expect(x).toBeLessThan(95)
      }
    }
  })

  it('a popped bubble is replaced in place by a fresh one; a bubble already gone is ignored', () => {
    const rng = seeded(7)
    const start = initialBubbles(rng)
    const popped = start[2]!
    const { bubbles, nextId } = replaceBubble(start, popped.id, rng, 10, false)
    expect(bubbles).toHaveLength(BUBBLE_COUNT)
    expect(bubbles[2]!.id).toBe(10)
    expect(bubbles[2]!.y).toBeGreaterThan(100)
    expect(nextId).toBe(11)
    expect(bubbles.filter((b) => b.id !== 10)).toEqual(start.filter((b) => b.id !== popped.id))

    const again = replaceBubble(bubbles, popped.id, rng, 11, false)
    expect(again.bubbles).toBe(bubbles)
    expect(again.nextId).toBe(11)
  })

  it('with Reduce Motion a replacement appears on screen rather than drifting in', () => {
    const rng = seeded(8)
    const start = initialBubbles(rng)
    const { bubbles } = replaceBubble(start, start[0]!.id, rng, 20, true)
    expect(bubbles[0]!.y).toBeLessThan(100)
  })
})
