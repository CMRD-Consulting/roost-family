import type { Jot } from '@/data/snapshot'

const DONE_WINDOW_MS = 7 * 24 * 60 * 60_000

/** Open jots for the Inbox (spec §7.9), newest first. */
export function openJots(jots: Jot[]): Jot[] {
  return jots.filter((j) => j.doneAt === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Jots checked off within the last 7 days (shown collapsed under the open ones), most recently done first. */
export function recentlyDoneJots(jots: Jot[], now: Date): Jot[] {
  const since = now.getTime() - DONE_WINDOW_MS
  return jots
    .filter((j): j is Jot & { doneAt: string } => j.doneAt !== null && Date.parse(j.doneAt) >= since)
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt))
}
