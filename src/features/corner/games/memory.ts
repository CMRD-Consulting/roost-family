/** Pure model for the Memory game (Kids' Corner, spec §7.5): flip cards two at a time to find matching animals. */
import type { Rng } from './bubbles'
import type { FarmAnimal } from './farm'
import { shuffle } from './rounds'

export interface MemoryCard {
  id: number
  animal: FarmAnimal
  faceUp: boolean
  matched: boolean
}

export interface MemoryState {
  cards: MemoryCard[]
  /** Ids of the cards face up and not yet matched: none, one, or a missed pair waiting to turn back. */
  open: number[]
}

export type FlipResult = 'ignored' | 'first' | 'match' | 'miss'

export const MEMORY_PAIRS = 6

/** Deals `pairs` animals twice each, shuffled, all face down. */
export function deal(animals: readonly FarmAnimal[], rng: Rng, pairs = MEMORY_PAIRS): MemoryState {
  const chosen = shuffle(animals, rng).slice(0, pairs)
  const cards = shuffle(
    chosen.flatMap((animal) => [animal, animal]),
    rng,
  ).map((animal, id) => ({ id, animal, faceUp: false, matched: false }))
  return { cards, open: [] }
}

/**
 * Turns a card over. Ignored while a missed pair is still showing, and for a card already face up. The second
 * card of a pair either matches (both stay up, marked matched) or misses (both stay up until `hideMisses`).
 */
export function flip(state: MemoryState, id: number): { state: MemoryState; result: FlipResult } {
  const card = state.cards.find((c) => c.id === id)
  if (!card || card.faceUp || card.matched || state.open.length >= 2) return { state, result: 'ignored' }
  const cards = state.cards.map((c) => (c.id === id ? { ...c, faceUp: true } : c))
  if (state.open.length === 0) return { state: { cards, open: [id] }, result: 'first' }

  const first = cards.find((c) => c.id === state.open[0])!
  if (first.animal.key === card.animal.key) {
    const matched = cards.map((c) => (c.id === id || c.id === first.id ? { ...c, matched: true } : c))
    return { state: { cards: matched, open: [] }, result: 'match' }
  }
  return { state: { cards, open: [first.id, id] }, result: 'miss' }
}

/** Turns a missed pair face down again. */
export function hideMisses(state: MemoryState): MemoryState {
  if (state.open.length < 2) return state
  const open = new Set(state.open)
  return { cards: state.cards.map((c) => (open.has(c.id) ? { ...c, faceUp: false } : c)), open: [] }
}

export function isComplete(state: MemoryState): boolean {
  return state.cards.every((c) => c.matched)
}
