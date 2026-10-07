import { describe, expect, it } from 'vitest'
import { FARM_ANIMALS } from './farm'
import { makeRound, shuffle, type Round } from './rounds'
import type { FarmAnimal } from './farm'

function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('rounds', () => {
  it('shuffle keeps every item exactly once and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const out = shuffle(input, seeded(1))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a round has the answer among distinct choices, and never repeats the previous answer', () => {
    const rng = seeded(2)
    let previous: string | null = null
    for (let i = 0; i < 100; i++) {
      const round: Round<FarmAnimal> = makeRound(FARM_ANIMALS, rng, 3, previous)
      expect(round.choices).toHaveLength(3)
      expect(new Set(round.choices.map((c) => c.key)).size).toBe(3)
      expect(round.choices).toContain(round.answer)
      expect(round.answer.key).not.toBe(previous)
      previous = round.answer.key
    }
  })

  it('every animal gets asked about eventually', () => {
    const rng = seeded(3)
    const seen = new Set<string>()
    let previous: string | null = null
    for (let i = 0; i < 200; i++) {
      const round: Round<FarmAnimal> = makeRound(FARM_ANIMALS, rng, 3, previous)
      seen.add(round.answer.key)
      previous = round.answer.key
    }
    expect(seen.size).toBe(FARM_ANIMALS.length)
  })

  it('refuses a round with more choices than items', () => {
    expect(() => makeRound(FARM_ANIMALS.slice(0, 2), seeded(4), 3, null)).toThrow()
  })
})
