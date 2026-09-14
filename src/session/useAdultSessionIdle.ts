import { onScopeDispose, watch } from 'vue'
import type { AdultSession } from './adultSession'
import { ADULT_SESSION_IDLE_MS, startIdleTimer } from './idleTimer'

export interface AdultSessionIdleOptions {
  /** The current adult session, if any. Read reactively. */
  session: () => AdultSession | null
  /** While true, an idle expiry is deferred; the idle period restarts when it clears. Read reactively. */
  busy: () => boolean
  /** Called synchronously when the session expires, before it is ended. Clear it from state here. */
  onExpired: () => void
  idleMs?: number
}

function endQuietly(session: AdultSession) {
  void session.end().catch(() => {})
}

/**
 * Ends the adult session after `idleMs` without a touch (spec §6.3), when it is replaced by a
 * different session, and when the owning scope (component) is disposed.
 */
export function useAdultSessionIdle(options: AdultSessionIdleOptions): void {
  const idleMs = options.idleMs ?? ADULT_SESSION_IDLE_MS
  let current: AdultSession | null = null
  let stopTimer: (() => void) | null = null
  let deferredWhileBusy = false

  function clearTimer() {
    stopTimer?.()
    stopTimer = null
    deferredWhileBusy = false
  }

  function arm() {
    clearTimer()
    stopTimer = startIdleTimer(onIdle, idleMs)
  }

  function onIdle() {
    stopTimer = null
    if (options.busy()) {
      deferredWhileBusy = true
      return
    }
    const session = current
    if (!session) return
    current = null
    options.onExpired()
    endQuietly(session)
  }

  watch(
    options.session,
    (next) => {
      if (next === current) return
      clearTimer()
      const previous = current
      current = next
      if (previous && next) endQuietly(previous)
      if (next) arm()
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    options.busy,
    (busy) => {
      if (!busy && deferredWhileBusy && current) arm()
    },
    { flush: 'sync' },
  )

  onScopeDispose(() => {
    clearTimer()
    const session = current
    current = null
    if (session) endQuietly(session)
  })
}
