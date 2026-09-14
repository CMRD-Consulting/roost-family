import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { inverseCommand } from '@/data/inverseCommand'
import { requiresOnline, type LogCommand } from '@/data/logCommands'
import { LogWriteError, type LogWriter } from '@/data/logWriter'
import type { OfflineQueue, QueuedCommand } from '@/data/offlineQueue'
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
  /** The offline queue key, if this action went through the offline queue. */
  queueKey: number | null
}

function offlineError(): LogWriteError {
  return new LogWriteError("You're offline. Try again when connected.", true, null)
}

function isNetworkError(e: unknown): e is LogWriteError {
  return e instanceof LogWriteError && e.network
}

/** A deep plain-JSON copy: no Vue proxies (IndexedDB can't clone them) and no shared references with the UI. */
function plainCopy(cmd: LogCommand): LogCommand {
  return JSON.parse(JSON.stringify(toRaw(cmd))) as LogCommand
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

  /**
   * In-memory mirror of the offline queue, oldest first. This store is the queue's only writer, so the
   * mirror lets ordering decisions ("is anything waiting ahead of this command?") be made synchronously.
   */
  let queued: QueuedCommand[] = []
  /** Enqueues that have started but not finished; they count as a non-empty queue. */
  let enqueuing = 0
  /** The single replay run in progress, if any. */
  let replayPromise: Promise<void> | null = null
  /** Queue key of the item the replay is sending right now. */
  let inFlightKey: number | null = null
  /** A command being sent directly (not via the queue), including its fall-back enqueue on a network error. */
  let directSend: Promise<unknown> | null = null

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

  function syncPendingCount(): void {
    pendingCount.value = queued.length
  }

  function requireWriterAndQueue(): { writer: LogWriter; queue: OfflineQueue } {
    if (writer === null || queue === null) throw new Error('useLogStore().init() must be called before use')
    return { writer, queue }
  }

  function isOffline(): boolean {
    return householdStore.online === false
  }

  /** True while anything is waiting to be sent, so a new command must line up behind it. */
  function queueBusy(): boolean {
    return queued.length > 0 || enqueuing > 0 || replayPromise !== null
  }

  function removeFromMirror(key: number): void {
    queued = queued.filter((i) => i.key !== key)
    syncPendingCount()
  }

  /** Adds `cmd` to the offline queue. If the queue refuses it, removes its overlay and throws a QUEUE error. */
  async function enqueue(cmd: LogCommand, opts: { triggerReplay: boolean }): Promise<'queued'> {
    const { queue } = requireWriterAndQueue()
    enqueuing++
    let key: number
    try {
      key = await queue.enqueue(cmd)
    } catch (e) {
      console.warn('Offline queue refused a command', e)
      householdStore.removeOverlay(cmd)
      throw new LogWriteError("Couldn't save offline on this device.", false, 'QUEUE')
    } finally {
      enqueuing--
    }
    queued = [...queued, { key, command: cmd, enqueuedAt: new Date().toISOString() }]
    syncPendingCount()
    setLastAction(cmd, key)
    if (opts.triggerReplay && !isOffline()) void replay()
    return 'queued'
  }

  async function sendDirect(cmd: LogCommand, opts: { confirmOffline?: boolean }): Promise<'saved' | 'queued'> {
    const { writer } = requireWriterAndQueue()
    try {
      await writer.execute(cmd)
    } catch (e) {
      if (!isNetworkError(e)) {
        householdStore.removeOverlay(cmd)
        throw e
      }
      if (requiresOnline(cmd)) {
        // PIN commands are checked on the server and can't be queued.
        householdStore.removeOverlay(cmd)
        throw offlineError()
      }
      let toQueue = cmd
      if (toQueue.kind === 'dose.add') {
        if (!opts.confirmOffline) {
          householdStore.removeOverlay(cmd)
          throw new NeedsOfflineDoseConfirmation()
        }
        toQueue = markDoseLoggedOffline(toQueue)
      }
      // Not replaying now: the network just failed. The online event or the retry timer will.
      return enqueue(toQueue, { triggerReplay: false })
    }
    householdStore.markSaved(cmd)
    setLastAction(cmd, null)
    return 'saved'
  }

  async function submit(cmd: LogCommand, opts: { confirmOffline?: boolean } = {}): Promise<'saved' | 'queued'> {
    requireWriterAndQueue()
    const offline = isOffline()

    if (requiresOnline(cmd) && offline) throw offlineError()

    let working = plainCopy(cmd)
    if (working.kind === 'dose.add' && offline) {
      if (!opts.confirmOffline) throw new NeedsOfflineDoseConfirmation()
      working = markDoseLoggedOffline(working)
    }

    householdStore.addOverlay(working)

    if (requiresOnline(working)) return sendDirect(working, opts)

    // A command already on its way to the server must land first. (Checked synchronously before and after
    // each wait, so no other submit can slip in between the check and the decision below.)
    while (directSend !== null) await directSend.catch(() => {})

    if (isOffline() || queueBusy()) return enqueue(working, { triggerReplay: true })

    const send = sendDirect(working, opts).finally(() => {
      if (directSend === send) directSend = null
    })
    directSend = send
    return send
  }

  async function undo(): Promise<'undone' | 'needsPin'> {
    const action = lastAction.value
    if (action === null) return 'undone'
    if (action.command.kind === 'dose.add') return 'needsPin'

    clearUndoTimer()
    lastAction.value = null

    const key = action.queueKey
    if (key !== null) {
      // Being sent right now: let that finish, then undo it like any other sent command.
      while (inFlightKey === key && replayPromise !== null) await replayPromise.catch(() => {})
      if (queued.some((i) => i.key === key)) {
        const { queue } = requireWriterAndQueue()
        removeFromMirror(key)
        householdStore.removeOverlay(action.command)
        await queue.remove(key)
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

  async function runReplay(): Promise<void> {
    const { writer, queue } = requireWriterAndQueue()
    while (directSend !== null) await directSend.catch(() => {})

    while (queued.length > 0 && !isOffline()) {
      const item = queued[0]!
      inFlightKey = item.key
      let error: unknown = null
      try {
        await writer.execute(item.command)
      } catch (e) {
        if (isNetworkError(e)) {
          inFlightKey = null
          break
        }
        error = e
      }
      // Leave the mirror before the async queue removal, so an undo in between sees the command as sent.
      removeFromMirror(item.key)
      inFlightKey = null
      if (error === null) {
        householdStore.markSaved(item.command)
      } else {
        householdStore.removeOverlay(item.command)
        failures.value = [...failures.value, error instanceof Error ? error.message : String(error)]
      }
      await queue.remove(item.key)
    }
  }

  /** Sends queued commands in order. Concurrent calls share the run already in progress. */
  function replay(): Promise<void> {
    if (replayPromise === null) {
      const run = runReplay().finally(() => {
        if (replayPromise === run) replayPromise = null
      })
      replayPromise = run
    }
    return replayPromise
  }

  async function replayIfPending(): Promise<void> {
    if (queued.length > 0) await replay()
  }

  function handleOnline(): void {
    void replay()
  }

  async function init(w: LogWriter, q: OfflineQueue): Promise<void> {
    writer = w
    queue = q
    queued = await q.list()
    // Queued-but-unsent commands must still show optimistically, even before their first replay.
    for (const item of queued) householdStore.addOverlay(item.command)
    syncPendingCount()

    window.addEventListener('online', handleOnline)
    if (replayTimer !== null) clearInterval(replayTimer)
    replayTimer = setInterval(() => void replayIfPending(), 30_000)

    await replay()
  }

  return { lastAction, pendingCount, failures, init, submit, undo, replay }
})
