/**
 * Leaving Kids' Corner (spec §7.3, §7.5): the route guard's rule, and the offline fallback pattern used when an
 * adult PIN can't be checked.
 */
import type { InjectionKey } from 'vue'
import type { DisplayStoreKind } from '@/session/displayStore'

/** Routes a display-state change sends the tablet to; these may always leave the Corner. */
const DISPLAY_STATE_PATHS = new Set(['/', '/setup', '/removed'])

/**
 * Pure: may the router leave `/corner` for `to`? Only after the PIN (or the offline pattern) authorized the
 * exit, or when the display itself was removed or unregistered. Anything else (history back, a stray link)
 * is cancelled so a child can't slip out. `/` redirects to `/home` before guards run, so the display state is
 * checked as well as the target path.
 */
export function cornerLeaveAllowed(
  to: { path: string },
  input: { authorizedExit: boolean; displayKind: DisplayStoreKind | null },
): boolean {
  if (input.authorizedExit) return true
  if (DISPLAY_STATE_PATHS.has(to.path)) return true
  return input.displayKind === 'revoked' || input.displayKind === 'unregistered'
}

/** Random numbers in [0, 1). Injected so tests can seed the dot positions. */
export type Rng = () => number
export const EXIT_PATTERN_RNG: InjectionKey<Rng> = Symbol('exitPatternRng')

/** A small deterministic generator (mulberry32) for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const PATTERN_DOTS = 4
/** From the first tap, the whole sequence must be finished within this long. */
export const PATTERN_WINDOW_MS = 10_000

const COLS = 4
const ROWS = 2
/** How far a dot may wander from its cell's centre, as a share of the cell. */
const JITTER = 0.3

export interface PatternDot {
  n: number
  col: number
  row: number
  /** Centre, as a percentage of the pattern area's width and height. */
  x: number
  y: number
}

/** Pure: dots 1-4 at random, non-overlapping spots (distinct cells of a 4x2 grid, jittered within the cell). */
export function patternDots(rng: Rng): PatternDot[] {
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => i)
  // Fisher-Yates shuffle, then take the first four cells.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
  }
  return cells.slice(0, PATTERN_DOTS).map((cell, index) => {
    const col = cell % COLS
    const row = Math.floor(cell / COLS)
    const jitterX = (rng() - 0.5) * JITTER
    const jitterY = (rng() - 0.5) * JITTER
    return { n: index + 1, col, row, x: ((col + 0.5 + jitterX) / COLS) * 100, y: ((row + 0.5 + jitterY) / ROWS) * 100 }
  })
}

export interface PatternState {
  /** The number the adult must tap next (1-4). */
  next: number
  /** When dot 1 was tapped, or null before that. */
  startedAt: number | null
}

export function startPattern(): PatternState {
  return { next: 1, startedAt: null }
}

/** Pure: the pattern after tapping dot `n` at `now`. Out of order, or too slow, starts over. */
export function tapPatternDot(state: PatternState, n: number, now: number): { state: PatternState; complete: boolean } {
  const expired = state.startedAt !== null && now - state.startedAt > PATTERN_WINDOW_MS
  const current = expired ? startPattern() : state
  if (n === 1 && current.next !== 1) return { state: { next: 2, startedAt: now }, complete: false }
  if (n !== current.next) return { state: startPattern(), complete: false }
  const startedAt = current.startedAt ?? now
  if (n === PATTERN_DOTS) return { state: startPattern(), complete: true }
  return { state: { next: n + 1, startedAt }, complete: false }
}
