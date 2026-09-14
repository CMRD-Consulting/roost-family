const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const

export const ADULT_SESSION_IDLE_MS = 5 * 60_000

/** Calls `onIdle` once after `idleMs` without pointer or key activity. Returns a stop function. */
export function startIdleTimer(onIdle: () => void, idleMs = ADULT_SESSION_IDLE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stop()
      onIdle()
    }, idleMs)
  }
  const stop = () => {
    clearTimeout(timer)
    for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, reset)
  }
  for (const e of ACTIVITY_EVENTS) window.addEventListener(e, reset, { passive: true })
  reset()
  return stop
}
