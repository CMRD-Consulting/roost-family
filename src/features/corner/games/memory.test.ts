import { describe, expect, it } from 'vitest'
import { FARM_ANIMALS } from './farm'
import { deal, flip, hideMisses, isComplete, MEMORY_PAIRS, type MemoryState } from './memory'

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

/** Ids of the two cards showing `key`. */
const pair = (state: MemoryState, key: string) => state.cards.filter((c) => c.animal.key === key).map((c) => c.id)

describe('memory', () => {
  it('deals six pairs face down, from distinct animals', () => {
    const state = deal(FARM_ANIMALS, seeded(1))
    expect(state.cards).toHaveLength(MEMORY_PAIRS * 2)
    expect(state.cards.every((c) => !c.faceUp && !c.matched)).toBe(true)
    const counts = new Map<string, number>()
    for (const c of state.cards) counts.set(c.animal.key, (counts.get(c.animal.key) ?? 0) + 1)
    expect(counts.size).toBe(MEMORY_PAIRS)
    expect([...counts.values()].every((n) => n === 2)).toBe(true)
  })

  it('a matching second card marks the pair matched; a miss leaves both up until hidden', () => {
    let state = deal(FARM_ANIMALS, seeded(2))
    const [a1, a2] = pair(state, state.cards[0]!.animal.key)
    const other = state.cards.find((c) => c.animal.key !== state.cards[0]!.animal.key)!.id

    let r = flip(state, a1!)
    expect(r.result).toBe('first')
    state = r.state
    r = flip(state, other)
    expect(r.result).toBe('miss')
    state = r.state
    expect(state.cards.filter((c) => c.faceUp)).toHaveLength(2)
    // Nothing else turns while the miss is showing.
    expect(flip(state, a2!).result).toBe('ignored')
    state = hideMisses(state)
    expect(state.cards.every((c) => !c.faceUp)).toBe(true)

    state = flip(state, a1!).state
    r = flip(state, a2!)
    expect(r.result).toBe('match')
    state = r.state
    expect(state.cards.filter((c) => c.matched).map((c) => c.id).sort()).toEqual([a1, a2].sort())
    expect(state.open).toEqual([])
    // Matched and face-up cards can't be turned again.
    expect(flip(state, a1!).result).toBe('ignored')
  })

  it('is complete once every pair is found', () => {
    let state = deal(FARM_ANIMALS, seeded(3))
    expect(isComplete(state)).toBe(false)
    for (const key of new Set(state.cards.map((c) => c.animal.key))) {
      const [x, y] = pair(state, key)
      state = flip(flip(state, x!).state, y!).state
    }
    expect(isComplete(state)).toBe(true)
  })

  it('hideMisses is a no-op with fewer than two open cards', () => {
    const state = deal(FARM_ANIMALS, seeded(4))
    const one = flip(state, 0).state
    expect(hideMisses(one)).toBe(one)
  })
})
