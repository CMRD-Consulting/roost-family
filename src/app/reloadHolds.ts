import { onScopeDispose, ref, watch } from 'vue'

/**
 * Work an app update must not reload the display under (spec §5.8), reported by the screens doing it:
 * - `signIn`: an adult sign-in is open (entering an email code, or signed in). A critical update waits for it; the
 *   normal rules (5 minutes idle, Night Mode) already outlast it.
 * - `photoUpload`: photos are being prepared and uploaded. No update reloads during one, critical or not.
 *
 * Plain Vue state rather than a Pinia store, so session composables can report holds without an active Pinia.
 */
export type ReloadHoldKind = 'signIn' | 'photoUpload'

const holds = ref(new Map<string, ReloadHoldKind>())
let nextId = 0

export function holdReload(key: string, kind: ReloadHoldKind): void {
  holds.value.set(key, kind)
}

export function releaseReload(key: string): void {
  holds.value.delete(key)
}

export function hasReloadHold(kind: ReloadHoldKind): boolean {
  for (const held of holds.value.values()) if (held === kind) return true
  return false
}

/** Test helper: forget every hold. */
export function clearReloadHolds(): void {
  holds.value.clear()
}

/** Holds reloads of `kind` while `active()` is true; released when it turns false and when the owning scope ends. */
export function useReloadHold(kind: ReloadHoldKind, active: () => boolean = () => true): void {
  const key = `${kind}-${++nextId}`
  watch(active, (on) => (on ? holdReload(key, kind) : releaseReload(key)), { immediate: true, flush: 'sync' })
  onScopeDispose(() => releaseReload(key))
}
