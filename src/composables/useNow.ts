import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * A `Date` ref that ticks every `intervalMs` (a number, ref or getter; when it changes the ref updates at
 * once and the interval restarts at the new rate). Pauses while the page is hidden
 * (`document.visibilityState === 'hidden'`) and, on becoming visible again,
 * updates immediately and restarts the interval. Cleans up on scope dispose.
 */
export function useNow(intervalMs: MaybeRefOrGetter<number> = 15_000): Ref<Date> {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | undefined

  function start(): void {
    if (timer !== undefined) return
    timer = setInterval(() => {
      now.value = new Date()
    }, toValue(intervalMs))
  }

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      stop()
    } else {
      now.value = new Date()
      start()
    }
  }

  start()
  document.addEventListener('visibilitychange', handleVisibilityChange)

  watch(
    () => toValue(intervalMs),
    () => {
      if (timer === undefined) return // hidden: the next visibilitychange starts at the new rate
      stop()
      now.value = new Date()
      start()
    },
    { flush: 'sync' },
  )

  onScopeDispose(() => {
    stop()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return now
}
