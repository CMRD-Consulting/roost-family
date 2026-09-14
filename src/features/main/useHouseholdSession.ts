import { computed, effectScope, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect, type ComputedRef, type EffectScope } from 'vue'
import { useRouter, type Router } from 'vue-router'
import { useNow } from '@/composables/useNow'
import { DEMO_DISPLAY, isDemo, selectSource, selectWriter, type HouseholdSource } from '@/data/householdSource'
import { createOfflineQueue } from '@/data/offlineQueue'
import { checkStillRegistered } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import { napShouldEnd, useModesStore } from '@/stores/modesStore'

const RETRY_MS = 30_000
const HEARTBEAT_MS = 5 * 60_000

export interface HouseholdSessionHandle {
  /** True when the household can't be loaded at all (nothing cached to show). */
  unreachable: ComputedRef<boolean>
}

interface Session {
  householdStore: ReturnType<typeof useHouseholdStore>
  users: number
  unreachable: ComputedRef<boolean>
  /** Starts (or restarts) the log store once the source is known. */
  resumeLogging(): void
  /** Stops only the log store (cheap to restart: it re-reads the offline queue). */
  pauseLogging(): void
  dispose(): void
}

/** The one session shared by every household screen that's currently mounted. */
let current: Session | null = null

function createSession(router: Router): Session {
  const householdStore = useHouseholdStore()
  const displayStore = useDisplayStore()
  const logStore = useLogStore()
  const modes = useModesStore()
  const scope: EffectScope = effectScope(true)

  let source: HouseholdSource | null = null
  let disposed = false
  /** Set once logging has been started (the log store runs while a household screen is shown). */
  let loggingStarted = false
  const bootFailed = ref(false)

  async function startLogging(): Promise<void> {
    if (loggingStarted || disposed) return
    loggingStarted = true
    try {
      // Hand the store the writer while it's still loading, so saves made meanwhile wait for it instead of
      // failing. (logStore.stop() cancels this init if the writer hasn't arrived.)
      await logStore.init(selectWriter(), createOfflineQueue())
    } catch (e) {
      console.warn('Could not start logging; retrying', e)
      loggingStarted = false
    }
  }

  async function boot(): Promise<void> {
    const identity = isDemo ? DEMO_DISPLAY : displayStore.identity
    if (!identity) {
      await router.replace('/')
      return
    }
    try {
      source ??= await selectSource()
    } catch {
      bootFailed.value = true
      return
    }
    if (disposed) return
    bootFailed.value = false
    const starting = householdStore.start(identity.householdId, source)
    // After start() has claimed the household, so the overlay of restored queued commands isn't cleared.
    void startLogging()
    await starting
  }

  function retry(): void {
    if (bootFailed.value) void boot()
    else if (householdStore.status === 'error' && !householdStore.snapshot) void householdStore.reload()
    if (source !== null && !bootFailed.value) void startLogging()
  }

  async function heartbeat(): Promise<void> {
    try {
      const { displayClient } = await import('@/data/supabase')
      if ((await checkStillRegistered(displayClient)) !== 'revoked' || disposed) return
      await displayStore.refresh()
      await router.replace('/removed')
    } catch {
      // Offline or a server error: the next heartbeat tries again.
    }
  }

  // Everything reactive lives in the session's own detached scope: it's created while a screen mounts, but
  // must outlive that screen when the next one takes the session over.
  const unreachable = scope.run(() => {
    const now = useNow(15_000)

    // A background display refresh (displayStore.watch) can also discover that this tablet was removed.
    watch(
      () => displayStore.state?.kind,
      (kind) => {
        if (disposed) return
        if (kind === 'revoked') void router.replace('/removed')
        else if (kind === 'unregistered') void router.replace('/')
      },
    )

    // Nap Mode isn't ended from inside the store on its own — the store only knows the rule (napShouldEnd);
    // the session watches the live view and clock and calls endNap() when the rule fires.
    watchEffect(() => {
      const nap = modes.nap
      const view = householdStore.view
      if (nap !== null && view !== null && napShouldEnd(nap, view, now.value)) modes.endNap()
    })

    return computed(() => bootFailed.value || (householdStore.status === 'error' && !householdStore.snapshot))
  })!

  void boot()
  const retryTimer = setInterval(retry, RETRY_MS)
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let stopDisplayWatch: (() => void) | undefined
  if (!isDemo) {
    stopDisplayWatch = displayStore.watch()
    void heartbeat()
    heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS)
  }

  return {
    householdStore,
    users: 0,
    unreachable,
    resumeLogging() {
      if (source !== null && !bootFailed.value) void startLogging()
    },
    pauseLogging() {
      logStore.stop()
      loggingStarted = false
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearInterval(retryTimer)
      clearInterval(heartbeatTimer)
      stopDisplayWatch?.()
      scope.stop()
      logStore.stop()
      householdStore.stop()
    },
  }
}

function release(session: Session): void {
  session.users--
  if (session.users > 0) return
  session.pauseLogging()
  // Moving between household screens unmounts one before mounting the next, in the same render flush.
  // Stopping the household store only after that flush lets the next screen take the running session over
  // (a restart would blank the view, reload and resubscribe).
  queueMicrotask(() => {
    if (session.users > 0 || current !== session) return
    current = null
    session.dispose()
  })
}

/**
 * Keeps this display's household live while a household screen (main screen, Kids' Corner) is mounted:
 * loads the household and starts logging, retries a failed boot, watches for the display being removed
 * (heartbeat + background display refresh), and ends Nap Mode when its rule fires. Screens share one session.
 */
export function useHouseholdSession(): HouseholdSessionHandle {
  const router = useRouter()
  const householdStore = useHouseholdStore()
  const session = shallowRef<Session | null>(null)

  onMounted(() => {
    // A different Pinia (e.g. a fresh app in tests) means the old session drives stores nobody shows any more.
    if (current !== null && current.householdStore !== householdStore) {
      current.dispose()
      current = null
    }
    const handedOver = current !== null
    current ??= createSession(router)
    current.users++
    if (handedOver && current.users === 1) current.resumeLogging()
    session.value = current
  })

  onBeforeUnmount(() => {
    if (session.value !== null) release(session.value)
  })

  return { unreachable: computed(() => session.value?.unreachable.value ?? false) }
}
