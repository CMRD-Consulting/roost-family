/**
 * Night Mode slideshow timing and order (spec §7.7): one photo a minute, in a shuffled order that stays the same for
 * the whole night (so leaving and returning to Night Mode picks up where the clock says, not from the start).
 */
import { householdDate } from '@/domain/time'

export const SLIDE_MS = 60_000
export const CROSSFADE_MS = 1_500
/** Signed URLs are refreshed this long before they expire. */
export const URL_REFRESH_MARGIN_MS = 5 * 60_000
/** After a failed URL refresh (offline), try again this often. */
export const URL_RETRY_MS = 60_000

const HOUR_MS = 3_600_000

/** The night a moment belongs to: the household date 12 hours earlier, so an evening and the following early
 *  morning share one seed. */
export function nightSeed(now: Date, timeZone: string): string {
  return householdDate(new Date(now.getTime() - 12 * HOUR_MS), timeZone)
}

/** The slideshow position for a moment: one slot per minute, the same on every display and across remounts. */
export function slotAt(epochMs: number): number {
  return Math.floor(epochMs / SLIDE_MS)
}

/** 32-bit FNV-1a hash of a string, as a PRNG seed. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32: a small deterministic PRNG returning numbers in [0, 1). */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** `ids` in a shuffled order determined only by the set of ids and `seed`. */
export function shuffledOrder(ids: readonly string[], seed: string): string[] {
  const order = [...ids].sort()
  const next = random(hash(seed))
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

/** The photo to show in `slot`: that slot's photo if it has loaded, else the next loaded one in order; null when
 *  none has. */
export function nextShown(order: readonly string[], slot: number, loaded: ReadonlySet<string>): string | null {
  const n = order.length
  for (let k = 0; k < n; k++) {
    const id = order[(((slot + k) % n) + n) % n]!
    if (loaded.has(id)) return id
  }
  return null
}
