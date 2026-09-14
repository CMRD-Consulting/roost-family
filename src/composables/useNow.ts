import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * A `Date` ref that ticks every `intervalMs`. Pauses while the page is hidden
 * (`document.visibilityState === 'hidden'`) and, on becoming visible again,
 * updates immediately and restarts the interval. Cleans up on scope dispose.
 */
export function useNow(intervalMs = 15_000): Ref<Date> {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | undefined

  function start(): void {
    if (timer !== undefined) return
    timer = setInterval(() => {
      now.value = new Date()
    }, intervalMs)
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

  onScopeDispose(() => {
    stop()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return now
}
