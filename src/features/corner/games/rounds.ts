/** Pure helpers for the pick-the-right-one games (Who Said That?, Colors): one answer among a few choices. */
import type { Rng } from './bubbles'

export interface Round<T> {
  answer: T
  /** The answer and its distractors, shuffled. */
  choices: T[]
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * A new round: an answer that isn't the previous one (so the same thing isn't asked twice running), plus
 * `choiceCount - 1` distractors, all shuffled.
 */
export function makeRound<T extends { key: string }>(
  items: readonly T[],
  rng: Rng,
  choiceCount: number,
  previousKey: string | null,
): Round<T> {
  if (items.length < choiceCount) throw new Error('Not enough items for a round')
  const candidates = items.filter((i) => i.key !== previousKey)
  const pool = candidates.length > 0 ? candidates : items
  const answer = pool[Math.floor(rng() * pool.length)]!
  const distractors = shuffle(
    items.filter((i) => i.key !== answer.key),
    rng,
  ).slice(0, choiceCount - 1)
  return { answer, choices: shuffle([answer, ...distractors], rng) }
}
