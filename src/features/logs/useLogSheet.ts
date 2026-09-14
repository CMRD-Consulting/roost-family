import { computed, ref } from 'vue'
import { DEMO_DISPLAY, isDemo } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import { LogWriteError } from '@/data/logWriter'
import { useDisplayStore } from '@/session/displayStore'
import { useHouseholdStore } from '@/stores/householdStore'
import { NeedsOfflineDoseConfirmation, useLogStore } from '@/stores/logStore'

export type SaveResult = 'saved' | 'queued'

function messageFor(e: unknown): string {
  // Network errors that reach the UI are the "needs a connection" kind, whose message is written for people.
  if (e instanceof LogWriteError && e.network) return e.message
  return "Couldn't save that. Please try again."
}

/** Shared plumbing for log sheets: the household view, this display's identity, and submit with inline errors. */
export function useLogSheet() {
  const householdStore = useHouseholdStore()
  const logStore = useLogStore()
  const displayStore = useDisplayStore()

  const view = computed(() => householdStore.view)
  const identity = computed<{ displayId: string } | null>(() =>
    isDemo ? { displayId: DEMO_DISPLAY.displayId } : displayStore.identity,
  )
  const displayId = computed(() => identity.value?.displayId ?? null)

  const pending = ref(0)
  const busy = computed(() => pending.value > 0)
  const error = ref<string | null>(null)

  /**
   * Submits through the log store. Returns the result, or null after showing an inline error.
   * `NeedsOfflineDoseConfirmation` is rethrown so the medicine sheet can ask before logging anyway.
   */
  async function submit(cmd: LogCommand, opts: { confirmOffline?: boolean } = {}): Promise<SaveResult | null> {
    pending.value++
    error.value = null
    try {
      return await logStore.submit(cmd, opts)
    } catch (e) {
      if (e instanceof NeedsOfflineDoseConfirmation) throw e
      error.value = messageFor(e)
      return null
    } finally {
      pending.value--
    }
  }

  function clearError(): void {
    error.value = null
  }

  return { view, identity, displayId, busy, error, submit, clearError }
}
