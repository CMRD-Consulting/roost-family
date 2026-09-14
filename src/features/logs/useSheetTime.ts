import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'

/**
 * A log sheet's time field (spec §7.4). It defaults to now and keeps following the clock while the sheet
 * stays open, until the adult steps it; from then on it stays put, still kept within [min, max]. `max` is
 * the live "now", so a sheet left open doesn't cap the time where it was when it opened.
 *
 * `min` is read lazily (a getter), so it may depend on state declared after this call.
 */
export function useSheetTime(min: () => string) {
  const now = useNow(15_000)
  const at = ref(now.value.toISOString())
  /** Set once the adult steps the time; cleared by `reset`. */
  const userAdjusted = ref(false)
  const max = computed(() => now.value.toISOString())

  /** Keeps `at` within [min, max]. */
  function clamp(): void {
    const atMs = Date.parse(at.value)
    const minMs = Date.parse(min())
    const maxMs = now.value.getTime()
    if (Number.isFinite(minMs) && atMs < minMs) at.value = new Date(minMs).toISOString()
    else if (atMs > maxMs) at.value = new Date(maxMs).toISOString()
  }

  watch(now, (n) => {
    if (userAdjusted.value) clamp()
    else at.value = n.toISOString()
  })

  /** The stepper's update: the adult chose a time, so stop following the clock. */
  function adjust(value: string): void {
    at.value = value
    userAdjusted.value = true
  }

  /** Back to following the clock from this moment (sheet opened). */
  function reset(): void {
    now.value = new Date()
    userAdjusted.value = false
    at.value = now.value.toISOString()
  }

  /** Brings an untouched time up to this instant (the clock only ticks every 15 s). Call right before saving. */
  function catchUp(): void {
    if (!userAdjusted.value) at.value = new Date().toISOString()
  }

  return { now, at, max, userAdjusted, adjust, reset, clamp, catchUp }
}
