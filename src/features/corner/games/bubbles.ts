/**
 * Pure model for the Bubbles game (Kids' Corner, spec §7.5): a handful of bubbles drift up the screen; a
 * popped bubble is replaced by a fresh one from below. Positions are percentages of the play area so the
 * model knows nothing about pixels; the component draws them.
 */

export type Rng = () => number

export interface Bubble {
  id: number
  /** Centre, as a percentage of the play area's width. */
  x: number
  /** Centre, as a percentage of the play area's height (0 = top). Beyond 100 is below the bottom edge. */
  y: number
  /** Diameter in CSS pixels. Every bubble is a comfortable in-the-moment touch target (≥ 60 pt). */
  size: number
  /** Rise speed, in percent of the play area's height per second. Slow: a toddler has to catch it. */
  speed: number
  /** Side-to-side sway: amplitude in percent of width, and where in the cycle this bubble started. */
  sway: number
  phase: number
}

export const BUBBLE_COUNT = 6
const MIN_SIZE = 110
const MAX_SIZE = 180
const MIN_SPEED = 5
const MAX_SPEED = 10
/** Where a replacement bubble starts and where a risen bubble is recycled: comfortably off-screen either way. */
const BELOW_Y = 118
const ABOVE_Y = -18

/** A new bubble: below the bottom edge, or anywhere on screen (`onScreen`, for Reduce Motion where nothing drifts). */
export function spawnBubble(rng: Rng, id: number, onScreen: boolean): Bubble {
  return {
    id,
    x: 12 + rng() * 76,
    y: onScreen ? 12 + rng() * 76 : BELOW_Y,
    size: Math.round(MIN_SIZE + rng() * (MAX_SIZE - MIN_SIZE)),
    speed: MIN_SPEED + rng() * (MAX_SPEED - MIN_SPEED),
    sway: 1 + rng() * 3,
    phase: rng() * Math.PI * 2,
  }
}

/** The opening set: spread over the screen so there is something to pop at once. */
export function initialBubbles(rng: Rng): Bubble[] {
  return Array.from({ length: BUBBLE_COUNT }, (_, i) => spawnBubble(rng, i + 1, true))
}

/** The bubble's drawn x: its lane plus a gentle sway that follows its height, so no extra state is needed. */
export function swayedX(bubble: Bubble): number {
  return bubble.x + bubble.sway * Math.sin(bubble.phase + bubble.y / 12)
}

/**
 * Moves every bubble up by `dtMs` of drift. A bubble that has risen off the top comes back as a new one from
 * below. Returns the new list and the next unused id.
 */
export function stepBubbles(bubbles: Bubble[], dtMs: number, rng: Rng, nextId: number): { bubbles: Bubble[]; nextId: number } {
  let id = nextId
  const moved = bubbles.map((b) => {
    const y = b.y - (b.speed * dtMs) / 1000
    if (y > ABOVE_Y) return { ...b, y }
    return spawnBubble(rng, id++, false)
  })
  return { bubbles: moved, nextId: id }
}

/** Replaces the popped bubble (if it is still there) with a fresh one. */
export function replaceBubble(bubbles: Bubble[], poppedId: number, rng: Rng, nextId: number, onScreen: boolean): { bubbles: Bubble[]; nextId: number } {
  if (!bubbles.some((b) => b.id === poppedId)) return { bubbles, nextId }
  return {
    bubbles: bubbles.map((b) => (b.id === poppedId ? spawnBubble(rng, nextId, onScreen) : b)),
    nextId: nextId + 1,
  }
}
