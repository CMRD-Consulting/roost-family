import { defineStore } from 'pinia'
import { ref } from 'vue'
import { inverseCommand } from '@/data/inverseCommand'
import { requiresOnline, type LogCommand } from '@/data/logCommands'
import { LogWriteError, type LogWriter } from '@/data/logWriter'
import type { OfflineQueue } from '@/data/offlineQueue'
import { useHouseholdStore } from './householdStore'

/** Thrown when a dose can't be safely logged offline (no way to check for a conflicting dose)
 *  until the adult explicitly confirms via `submit(cmd, { confirmOffline: true })`. */
export class NeedsOfflineDoseConfirmation extends Error {
  constructor() {
    super('Cannot check for a conflicting dose while offline. Confirm to log it anyway.')
  }
}

/** How long an action stays undoable after it's submitted. */
const UNDO_WINDOW_MS = 10_000

interface LastAction {
  command: LogCommand
  expiresAt: number
  /** The offline queue key, if this action is still sitting unsent in the queue. */
  queueKey: number | null
}

function offlineError(): LogWriteError {
  return new LogWriteError("You're offline. Try again when connected.", true, null)
}

function markDoseLoggedOffline(cmd: LogCommand & { kind: 'dose.add' }): LogCommand {
  return { ...cmd, entry: { ...cmd.entry, loggedOffline: true } }
}

export const useLogStore = defineStore('log', () => {
  const householdStore = useHouseholdStore()

  let writer: LogWriter | null = null
  let queue: OfflineQueue | null = null
  let undoTimer: ReturnType<typeof setTimeout> | null = null
  let replayTimer: ReturnType<typeof setInterval> | null = null

  const lastAction = ref<LastAction | null>(null)
  const pendingCount = ref(0)
  const failures = ref<string[]>([])

  function clearUndoTimer(): void {
    if (undoTimer !== null) {
      clearTimeout(undoTimer)
      undoTimer = null
    }
  }

  function setLastAction(command: LogCommand, queueKey: number | null): void {
    clearUndoTimer()
    lastAction.value = { command, expiresAt: Date.now() + UNDO_WINDOW_MS, queueKey }
    undoTimer = setTimeout(() => {
      lastAction.value = null
      undoTimer = null
    }, UNDO_WINDOW_MS)
  }

  async function refreshPendingCount(): Promise<void> {
    pendingCount.value = queue === null ? 0 : await queue.count()
  }

  function requireWriterAndQueue(): { writer: LogWriter; queue: OfflineQueue } {
    if (writer === null || queue === null) throw new Error('useLogStore().init() must be called before use')
    return { writer, queue }
  }

  async function submit(cmd: LogCommand, opts: { confirmOffline?: boolean } = {}): Promise<'saved' | 'queued'> {
    const { writer, queue } = requireWriterAndQueue()
    const offline = householdStore.online === false

    if (requiresOnline(cmd) && offline) throw offlineError()

    let working = cmd
    if (working.kind === 'dose.add' && offline) {
      if (!opts.confirmOffline) throw new NeedsOfflineDoseConfirmation()
      working = markDoseLoggedOffline(working)
    }

    householdStore.addOverlay(working)

    if (!offline) {
      try {
        await writer.execute(working)
        householdStore.markSaved(working)
        setLastAction(working, null)
        return 'saved'
      } catch (e) {
        if (e instanceof LogWriteError && e.network && requiresOnline(working)) {
          // PIN commands are checked on the server and can't be queued.
          householdStore.removeOverlay(working)
          throw offlineError()
        }
        if (e instanceof LogWriteError && e.network) {
          let toQueue = working
          if (toQueue.kind === 'dose.add') {
            if (!opts.confirmOffline) {
              householdStore.removeOverlay(working)
              throw new NeedsOfflineDoseConfirmation()
            }
            toQueue = markDoseLoggedOffline(toQueue)
          }
          const key = await queue.enqueue(toQueue)
          await refreshPendingCount()
          setLastAction(working, key)
          return 'queued'
        }
        householdStore.removeOverlay(working)
        throw e
      }
    }

    const key = await queue.enqueue(working)
    await refreshPendingCount()
    setLastAction(working, key)
    return 'queued'
  }

  async function undo(): Promise<'undone' | 'needsPin'> {
    const action = lastAction.value
    if (action === null) return 'undone'
    if (action.command.kind === 'dose.add') return 'needsPin'

    clearUndoTimer()
    lastAction.value = null

    if (action.queueKey !== null) {
      const { queue } = requireWriterAndQueue()
      const stillQueued = (await queue.list()).some((item) => item.key === action.queueKey)
      if (stillQueued) {
        await queue.remove(action.queueKey)
        await refreshPendingCount()
        householdStore.removeOverlay(action.command)
        return 'undone'
      }
    }

    const inverse = inverseCommand(action.command)
    if (inverse) await submit(inverse)
    // submit() above sets its own undo slot for the inverse; undoing is final, so clear it again.
    clearUndoTimer()
    lastAction.value = null
    return 'undone'
  }

  async function replay(): Promise<void> {
    const { writer, queue } = requireWriterAndQueue()
    if (householdStore.online === false) return

    for (const item of await queue.list()) {
      try {
        await writer.execute(item.command)
        await queue.remove(item.key)
        householdStore.markSaved(item.command)
      } catch (e) {
        if (e instanceof LogWriteError && e.network) break
        await queue.remove(item.key)
        householdStore.removeOverlay(item.command)
        failures.value = [...failures.value, e instanceof Error ? e.message : String(e)]
      }
    }
    await refreshPendingCount()
  }

  async function replayIfPending(): Promise<void> {
    if (queue !== null && (await queue.count()) > 0) await replay()
  }

  function handleOnline(): void {
    void replay()
  }

  async function init(w: LogWriter, q: OfflineQueue): Promise<void> {
    writer = w
    queue = q
    // Queued-but-unsent commands must still show optimistically, even before their first replay.
    for (const item of await q.list()) householdStore.addOverlay(item.command)
    await refreshPendingCount()

    window.addEventListener('online', handleOnline)
    if (replayTimer !== null) clearInterval(replayTimer)
    replayTimer = setInterval(() => void replayIfPending(), 30_000)

    await replay()
  }

  return { lastAction, pendingCount, failures, init, submit, undo, replay }
})
