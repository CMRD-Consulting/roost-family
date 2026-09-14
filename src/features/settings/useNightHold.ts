import { onScopeDispose, watch } from 'vue'
import { useModesStore } from '@/stores/modesStore'

let nextId = 0

/**
 * Keeps Night Mode from taking over while `active()` is true (spec §7.7: it never interrupts an adult mid-task).
 * Used by every full sign-in flow: Night Mode starting would otherwise end the Settings session under the adult.
 * Released when `active()` turns false and when the owning scope (component) goes away.
 */
export function useNightHold(active: () => boolean = () => true): void {
  const modes = useModesStore()
  const key = `full-sign-in-${++nextId}`
  watch(active, (on) => (on ? modes.holdNight(key) : modes.releaseNight(key)), { immediate: true, flush: 'sync' })
  onScopeDispose(() => modes.releaseNight(key))
}
