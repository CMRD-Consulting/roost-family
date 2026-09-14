import type { HouseholdSnapshot } from '../snapshot'
import { buildDemoSnapshot, type DemoOptions } from './demoFixture'

function optionsFromUrl(): DemoOptions {
  const params = new URLSearchParams(window.location.search)
  return { conflict: params.has('conflict'), manyKids: params.has('manyKids'), sitter: params.has('sitter') }
}

let snapshot: HouseholdSnapshot | null = null
let listeners = new Set<() => void>()

function ensureSnapshot(): HouseholdSnapshot {
  if (snapshot === null) snapshot = buildDemoSnapshot(new Date(), optionsFromUrl())
  return snapshot
}

/** A structured clone of the shared demo snapshot, with `loadedAt` (and the sample weather's `fetchedAt`) set to
 *  `now`, since there is no server to refresh it. Safe to mutate. */
export function getDemoSnapshot(now: Date): HouseholdSnapshot {
  const clone = structuredClone(ensureSnapshot())
  clone.loadedAt = now.toISOString()
  if (clone.weather) clone.weather.fetchedAt = now.toISOString()
  return clone
}

/** Replaces the shared demo snapshot with a plain copy of `fn(current)` and notifies listeners.
 *  (Plain, so reactive values from the UI can't leak in and break `structuredClone`.) */
export function mutateDemo(fn: (snapshot: HouseholdSnapshot) => HouseholdSnapshot): void {
  snapshot = JSON.parse(JSON.stringify(fn(ensureSnapshot()))) as HouseholdSnapshot
  for (const listener of listeners) listener()
}

/** Calls `listener` after every `mutateDemo`. Returns an unsubscribe function. */
export function onDemoChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test-only: discards the shared demo snapshot and listeners so the next access rebuilds a fresh fixture. */
export function resetDemoForTests(): void {
  snapshot = null
  listeners = new Set()
}
