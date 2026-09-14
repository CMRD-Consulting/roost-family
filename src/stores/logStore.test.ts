import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isProxy, reactive, toRaw } from 'vue'
import { createOfflineQueue } from '@/data/offlineQueue'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import type { HouseholdSource } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import { LogWriteError } from '@/data/logWriter'
import type { LogWriter } from '@/data/logWriter'
import type { OfflineQueue, QueuedCommand } from '@/data/offlineQueue'
import { requiresOnline } from '@/data/logCommands'
import { useHouseholdStore } from './householdStore'
import { NeedsOfflineDoseConfirmation, STUCK_COMMAND_MESSAGE, useLogStore } from './logStore'

/** Reports realtime as connected (like a healthy Supabase or the demo source) unless told otherwise. */
function fakeSource(snapshot: HouseholdSnapshot, realtime: 'connected' | 'disconnected' | null = 'connected'): HouseholdSource {
  return {
    async load() {
      return snapshot
    },
    subscribe(_id, _onChange, onStatus) {
      if (realtime !== null) onStatus?.(realtime)
      return () => {}
    },
  }
}

function createFakeQueue(): OfflineQueue {
  let items: QueuedCommand[] = []
  let nextKey = 1
  return {
    async enqueue(cmd: LogCommand) {
      if (requiresOnline(cmd)) throw new Error('cannot queue a command that requires a live connection')
      const key = nextKey++
      // Round-trip through JSON, matching the real IndexedDB-backed queue's storage semantics.
      items = [...items, { key, command: JSON.parse(JSON.stringify(cmd)), enqueuedAt: new Date().toISOString() }]
      return key
    },
    async list() {
      return items
    },
    async remove(key: number) {
      items = items.filter((i) => i.key !== key)
    },
    async count() {
      return items.length
    },
    async clear() {
      items = []
    },
  }
}

interface FakeWriter extends LogWriter {
  calls: LogCommand[]
  failNextWith: LogWriteError | Error | null
  failAlwaysWith: LogWriteError | Error | null
  /** While set, every execute() waits for it before resolving (after recording the call). */
  gate: Promise<void> | null
}

function createFakeWriter(): FakeWriter {
  const writer: FakeWriter = {
    calls: [],
    failNextWith: null,
    failAlwaysWith: null,
    gate: null,
    async execute(cmd: LogCommand) {
      writer.calls.push(cmd)
      if (writer.gate) await writer.gate
      if (writer.failAlwaysWith) throw writer.failAlwaysWith
      if (writer.failNextWith) {
        const err = writer.failNextWith
        writer.failNextWith = null
        throw err
      }
    },
    async verifyPin() {
      return true
    },
  }
  return writer
}

const HOUSEHOLD_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function dinnerCmd(text: string): LogCommand {
  return { kind: 'dinner.set', householdId: HOUSEHOLD_ID, text, previous: 'Tacos' }
}

function feedingCmd(id = 'feed-x'): LogCommand {
  return {
    kind: 'feeding.add',
    householdId: HOUSEHOLD_ID,
    entry: { id, childId: 'cccccccc-0000-0000-0000-000000000002', at: '2026-09-14T19:00:00.000Z', type: 'milk', amount: '4 oz', note: null },
    attribution: { displayId: 'demo-display', loggedByMembershipId: 'bbbbbbbb-0000-0000-0000-000000000001', sitterSessionId: null, loggedByName: 'Sam' },
  }
}

function doseCmd(id = 'dose-x'): LogCommand {
  return {
    kind: 'dose.add',
    householdId: HOUSEHOLD_ID,
    entry: {
      id, childId: 'cccccccc-0000-0000-0000-000000000002', medicineId: 'eeeeeeee-0000-0000-0000-000000000001',
      at: '2026-09-14T19:00:00.000Z', loggedByName: 'Sam', loggedOffline: false, voidedAt: null,
      conflictAcknowledgedAt: null, createdAt: '2026-09-14T19:00:00.000Z', note: null, warningsConfirmed: [],
    },
    attribution: { displayId: 'demo-display', loggedByMembershipId: 'bbbbbbbb-0000-0000-0000-000000000001', sitterSessionId: null, loggedByName: 'Sam' },
  }
}

async function setup(opts: { realtime?: 'connected' | 'disconnected' | null } = {}) {
  setActivePinia(createPinia())
  const now = new Date('2026-09-14T19:00:00Z')
  const snapshot = buildDemoSnapshot(now)
  const householdStore = useHouseholdStore()
  await householdStore.start(HOUSEHOLD_ID, fakeSource(snapshot, opts.realtime === undefined ? 'connected' : opts.realtime))
  const logStore = useLogStore()
  const writer = createFakeWriter()
  const queue = createFakeQueue()
  return { householdStore, logStore, writer, queue }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function sleepStartCmd(id = 'sleep-x'): LogCommand {
  return {
    kind: 'sleep.start',
    householdId: HOUSEHOLD_ID,
    entry: { id, childId: 'cccccccc-0000-0000-0000-000000000002', startAt: '2026-09-14T18:00:00.000Z', endAt: null, type: 'nap' },
    attribution: { displayId: 'demo-display', loggedByMembershipId: null, sitterSessionId: null, loggedByName: null },
  }
}

function sleepEndCmd(id = 'sleep-x'): LogCommand {
  return { kind: 'sleep.end', householdId: HOUSEHOLD_ID, entryId: id, endAt: '2026-09-14T19:00:00.000Z', previousEndAt: null }
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

describe('useLogStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setOnline(true)
  })

  describe('submit', () => {
    it('saves online: writer.execute succeeds, overlay is marked saved, and returns "saved"', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)

      const cmd = dinnerCmd('Pizza')
      const result = await logStore.submit(cmd)

      expect(result).toBe('saved')
      expect(writer.calls).toEqual([cmd])
      expect(householdStore.view?.household.dinnerTonight).toBe('Pizza')
      expect(householdStore.overlay[0]?.savedAt).not.toBeNull()
      expect(logStore.lastAction?.command).toEqual(cmd)
    })

    it('queues while offline and returns "queued"', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)

      const cmd = dinnerCmd('Pizza')
      const result = await logStore.submit(cmd)

      expect(result).toBe('queued')
      expect(writer.calls).toEqual([])
      expect(await queue.count()).toBe(1)
      expect(householdStore.view?.household.dinnerTonight).toBe('Pizza')
      expect(logStore.pendingCount).toBe(1)
    })

    it('offline dose.add without confirmOffline throws NeedsOfflineDoseConfirmation and adds no overlay', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)

      await expect(logStore.submit(doseCmd())).rejects.toBeInstanceOf(NeedsOfflineDoseConfirmation)
      expect(householdStore.overlay).toHaveLength(0)
      expect(await queue.count()).toBe(0)
    })

    it('offline dose.add with confirmOffline queues with loggedOffline=true', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)

      const result = await logStore.submit(doseCmd(), { confirmOffline: true })

      expect(result).toBe('queued')
      const queued = await queue.list()
      expect((queued[0]?.command as { entry: { loggedOffline: boolean } }).entry.loggedOffline).toBe(true)
      const overlayDose = householdStore.view?.doses.find((d) => d.id === 'dose-x')
      expect(overlayDose?.loggedOffline).toBe(true)
    })

    it('a network failure mid-save (non-dose) enqueues the command and returns "queued"', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      writer.failNextWith = new LogWriteError('offline', true, null)
      await logStore.init(writer, queue)

      const cmd = dinnerCmd('Pizza')
      const result = await logStore.submit(cmd)

      expect(result).toBe('queued')
      expect(await queue.count()).toBe(1)
      expect(householdStore.view?.household.dinnerTonight).toBe('Pizza')
    })

    it('a network failure mid-save for dose.add without confirmOffline removes the overlay and rethrows NeedsOfflineDoseConfirmation', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      writer.failNextWith = new LogWriteError('offline', true, null)
      await logStore.init(writer, queue)

      await expect(logStore.submit(doseCmd())).rejects.toBeInstanceOf(NeedsOfflineDoseConfirmation)
      expect(householdStore.overlay).toHaveLength(0)
      expect(await queue.count()).toBe(0)
    })

    it('a network failure mid-save for dose.add with confirmOffline enqueues with loggedOffline=true', async () => {
      const { logStore, writer, queue } = await setup()
      writer.failNextWith = new LogWriteError('offline', true, null)
      await logStore.init(writer, queue)

      const result = await logStore.submit(doseCmd(), { confirmOffline: true })

      expect(result).toBe('queued')
      const queued = await queue.list()
      expect((queued[0]?.command as { entry: { loggedOffline: boolean } }).entry.loggedOffline).toBe(true)
    })

    it('a non-network error removes the overlay and rethrows', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      writer.failNextWith = new LogWriteError('rejected', false, '23514')
      await logStore.init(writer, queue)

      await expect(logStore.submit(dinnerCmd('Pizza'))).rejects.toBeInstanceOf(LogWriteError)
      expect(householdStore.overlay).toHaveLength(0)
      expect(await queue.count()).toBe(0)
    })

    it('a command requiring a live connection throws immediately while offline', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)

      const cmd: LogCommand = { kind: 'dose.acknowledge', householdId: HOUSEHOLD_ID, doseId: 'd1', membershipId: 'm1', pin: '1234' }
      await expect(logStore.submit(cmd)).rejects.toBeInstanceOf(LogWriteError)
      expect(writer.calls).toEqual([])
    })

    it('a PIN command that hits a network failure removes its overlay and throws the offline error, never queueing', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const enqueue = vi.spyOn(queue, 'enqueue')
      writer.failNextWith = new LogWriteError('fetch failed', true, null)
      const doseId = householdStore.view!.doses[0]!.id

      const cmd: LogCommand = { kind: 'dose.void', householdId: HOUSEHOLD_ID, doseId, membershipId: 'm1', pin: '1234', reason: 'oops' }
      const err = await logStore.submit(cmd).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).message).toBe("You're offline. Try again when connected.")
      expect((err as LogWriteError).network).toBe(true)
      expect((err as LogWriteError).code).toBeNull()
      expect(householdStore.overlay).toHaveLength(0)
      expect(householdStore.view!.doses.find((d) => d.id === doseId)?.voidedAt).toBeNull()
      expect(enqueue).not.toHaveBeenCalled()
      expect(logStore.pendingCount).toBe(0)
    })
  })

  describe('dose offline flag', () => {
    const loggedOffline = (c: LogCommand | undefined) => (c as { entry: { loggedOffline: boolean } }).entry.loggedOffline

    it('with confirmOffline, overlay, queue and writer all carry loggedOffline=true; a permanent failure on replay clears it from view', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      writer.failNextWith = new LogWriteError('fetch failed', true, null)

      expect(await logStore.submit(doseCmd(), { confirmOffline: true })).toBe('queued')
      expect(loggedOffline(writer.calls[0])).toBe(true)
      expect(loggedOffline((await queue.list())[0]?.command)).toBe(true)
      expect(householdStore.view?.doses.find((d) => d.id === 'dose-x')?.loggedOffline).toBe(true)

      writer.failNextWith = new LogWriteError('medicine gone', false, '23503')
      await logStore.replay()

      expect(logStore.failures).toHaveLength(1)
      expect(householdStore.overlay).toHaveLength(0)
      expect(householdStore.view?.doses.some((d) => d.id === 'dose-x')).toBe(false)
    })

    it('with confirmOffline while connected, saves directly with loggedOffline=true', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)

      expect(await logStore.submit(doseCmd(), { confirmOffline: true })).toBe('saved')
      expect(loggedOffline(writer.calls[0])).toBe(true)
    })

    it.each([['disconnected' as const], [null]])('requires confirmation while realtime is not connected (%s), even though the browser is online', async (realtime) => {
      const { householdStore, logStore, writer, queue } = await setup({ realtime })
      await logStore.init(writer, queue)

      await expect(logStore.submit(doseCmd())).rejects.toBeInstanceOf(NeedsOfflineDoseConfirmation)
      expect(householdStore.overlay).toHaveLength(0)
      expect(writer.calls).toEqual([])

      expect(await logStore.submit(doseCmd(), { confirmOffline: true })).toBe('saved')
      expect(loggedOffline(writer.calls[0])).toBe(true)
    })

    it('does not ask for confirmation while online and realtime is connected', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)

      expect(await logStore.submit(doseCmd())).toBe('saved')
      expect(loggedOffline(writer.calls[0])).toBe(false)
    })
  })

  describe('plain data', () => {
    it('queues a command holding a reactive item in the real IndexedDB queue, as a plain snapshot', async () => {
      vi.useRealTimers() // fake-indexeddb schedules its work with real timers
      const { householdStore, logStore, writer } = await setup()
      const queue = createOfflineQueue(`roost-logstore-${Math.random().toString(36).slice(2)}`)
      await logStore.init(writer, queue)
      setOnline(false)
      const item = reactive({ id: 'grocery-r', text: 'Eggs', createdAt: '2026-09-14T19:00:00.000Z', checkedAt: null })

      const result = await logStore.submit({ kind: 'grocery.add', householdId: HOUSEHOLD_ID, item, displayId: null })
      item.text = 'Edited after submit'

      expect(result).toBe('queued')
      const [queued] = await queue.list()
      expect((queued!.command as { item: { text: string } }).item.text).toBe('Eggs')
      const overlayCmd = toRaw(householdStore.overlay)[0]!.command as { item: object }
      expect(isProxy(overlayCmd.item)).toBe(false)
      expect(householdStore.view?.groceries.find((g) => g.id === 'grocery-r')?.text).toBe('Eggs')
    })

    it('sends the writer a plain copy', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const item = reactive({ id: 'grocery-r', text: 'Eggs', createdAt: '2026-09-14T19:00:00.000Z', checkedAt: null })

      await logStore.submit({ kind: 'grocery.add', householdId: HOUSEHOLD_ID, item, displayId: null })

      expect(isProxy((writer.calls[0] as { item: object }).item)).toBe(false)
    })

    it('when the queue refuses the command, removes the overlay and throws a QUEUE error', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      vi.spyOn(queue, 'enqueue').mockRejectedValue(new DOMException('quota', 'QuotaExceededError'))
      setOnline(false)

      const err = await logStore.submit(dinnerCmd('Pizza')).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(LogWriteError)
      expect((err as LogWriteError).message).toBe("Couldn't save offline on this device.")
      expect((err as LogWriteError).network).toBe(false)
      expect((err as LogWriteError).code).toBe('QUEUE')
      expect(householdStore.overlay).toHaveLength(0)
      expect(logStore.pendingCount).toBe(0)
    })

    it('when a network failure falls back to a queue that refuses the command, removes the overlay and throws QUEUE', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      vi.spyOn(queue, 'enqueue').mockRejectedValue(new Error('boom'))
      writer.failNextWith = new LogWriteError('fetch failed', true, null)

      const err = await logStore.submit(dinnerCmd('Pizza')).catch((e: unknown) => e)

      expect((err as LogWriteError).code).toBe('QUEUE')
      expect(householdStore.overlay).toHaveLength(0)
    })
  })

  describe('init, stop and running without a queue', () => {
    function brokenIndexedDbQueue(): OfflineQueue {
      vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('IndexedDB is not available in private browsing', 'InvalidStateError')
      })
      return createOfflineQueue('roost-broken')
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('when the queue cannot open, init still registers the online listener and retry timer, and warns', async () => {
      const { logStore, writer } = await setup()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const addListener = vi.spyOn(window, 'addEventListener')

      await expect(logStore.init(writer, brokenIndexedDbQueue())).resolves.toBeUndefined()

      expect(addListener).toHaveBeenCalledWith('online', expect.any(Function))
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      expect(warn).toHaveBeenCalled()
      logStore.stop()
    })

    it('without a queue, online commands still save, and offline commands throw NO_QUEUE with no overlay left behind', async () => {
      const { householdStore, logStore, writer } = await setup()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await logStore.init(writer, brokenIndexedDbQueue())

      expect(await logStore.submit(dinnerCmd('Pizza'))).toBe('saved')

      writer.failNextWith = new LogWriteError('fetch failed', true, null)
      const networkErr = await logStore.submit(feedingCmd('feed-1')).catch((e: unknown) => e)
      expect((networkErr as LogWriteError).code).toBe('NO_QUEUE')
      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-1')).toBe(false)

      setOnline(false)
      const offlineErr = await logStore.submit(feedingCmd('feed-2')).catch((e: unknown) => e)
      expect(offlineErr).toBeInstanceOf(LogWriteError)
      expect((offlineErr as LogWriteError).message).toBe("Offline saving isn't available on this device.")
      expect((offlineErr as LogWriteError).network).toBe(true)
      expect((offlineErr as LogWriteError).code).toBe('NO_QUEUE')
      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-2')).toBe(false)
      logStore.stop()
    })

    it('re-init in the same session does not add a second overlay for a command still queued', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)
      await logStore.submit(feedingCmd('feed-1'))
      expect(householdStore.overlay).toHaveLength(1)
      logStore.stop()

      await logStore.init(writer, queue)

      expect(householdStore.overlay).toHaveLength(1)
      expect(logStore.pendingCount).toBe(1)
      logStore.stop()
    })

    /** A queue whose `list()` (opening it) waits until released. */
    function slowToOpen(inner: OfflineQueue): OfflineQueue & { open: () => void } {
      const gate = deferred()
      return { ...inner, list: async () => { await gate.promise; return inner.list() }, open: gate.resolve }
    }

    it('a submit made while init is still opening the queue waits for it instead of failing with NO_QUEUE', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      const slow = slowToOpen(queue)
      const initing = logStore.init(writer, slow)
      setOnline(false)

      let result: unknown = null
      const saving = logStore.submit(feedingCmd('feed-early')).then((r) => (result = r), (e: unknown) => (result = e))
      await Promise.resolve()
      expect(result).toBeNull() // waiting, not NO_QUEUE

      slow.open()
      await saving
      await initing
      expect(result).toBe('queued')
      expect(await queue.count()).toBe(1)
      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-early')).toBe(true)
      logStore.stop()
    })

    it('re-opening the queue on a re-init makes a submit wait, not report NO_QUEUE', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const slow = slowToOpen(queue)
      const reiniting = logStore.init(writer, slow)
      setOnline(false)

      const saving = logStore.submit(feedingCmd('feed-reinit')).catch((e: unknown) => e)
      slow.open()

      expect(await saving).toBe('queued')
      await reiniting
      logStore.stop()
    })

    it('init accepts a writer that is still loading, and a submit waits for it', async () => {
      const { logStore, writer, queue } = await setup()
      let provide!: (w: LogWriter) => void
      const initing = logStore.init(new Promise<LogWriter>((r) => (provide = r)), queue)

      const saving = logStore.submit(dinnerCmd('Pizza'))
      await Promise.resolve()
      expect(writer.calls).toEqual([])
      provide(writer)

      expect(await saving).toBe('saved')
      expect(writer.calls).toEqual([dinnerCmd('Pizza')])
      await initing
      logStore.stop()
    })

    it('stop while init waits for its writer leaves nothing running once the writer arrives', async () => {
      const { logStore, writer, queue } = await setup()
      let provide!: (w: LogWriter) => void
      const addListener = vi.spyOn(window, 'addEventListener')
      const initing = logStore.init(new Promise<LogWriter>((r) => (provide = r)), queue)
      logStore.stop()
      const timersBefore = vi.getTimerCount()

      provide(writer)
      await initing

      expect(addListener).not.toHaveBeenCalledWith('online', expect.any(Function))
      expect(vi.getTimerCount()).toBe(timersBefore)
    })

    it('stop removes the online listener and the retry timer', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const removeListener = vi.spyOn(window, 'removeEventListener')
      const timersBefore = vi.getTimerCount() // includes the household store's midnight timer

      logStore.stop()

      expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))
      expect(vi.getTimerCount()).toBe(timersBefore - 1)
      await queue.enqueue(dinnerCmd('Pizza'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(writer.calls).toEqual([])
    })

    it('the retry timer replays queued commands every 30 seconds', async () => {
      const { logStore, writer, queue } = await setup()
      writer.failNextWith = new LogWriteError('fetch failed', true, null)
      await logStore.init(writer, queue)
      await logStore.submit(dinnerCmd('Pizza'))
      writer.calls = []

      await vi.advanceTimersByTimeAsync(30_000)

      expect(writer.calls).toEqual([dinnerCmd('Pizza')])
      expect(await queue.count()).toBe(0)
      logStore.stop()
    })
  })

  describe('replay', () => {
    it('replays queued commands in order on success', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      await queue.enqueue(feedingCmd('feed-1'))

      await logStore.init(writer, queue)

      expect(writer.calls).toEqual([dinnerCmd('Pizza'), feedingCmd('feed-1')])
      expect(await queue.count()).toBe(0)
      expect(logStore.pendingCount).toBe(0)
      expect(householdStore.view?.household.dinnerTonight).toBe('Pizza')
      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-1')).toBe(true)
    })

    it('stops on the first network error, leaving later items queued', async () => {
      const { logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      await queue.enqueue(feedingCmd('feed-1'))
      writer.failNextWith = new LogWriteError('offline', true, null)

      await logStore.init(writer, queue)

      expect(await queue.count()).toBe(2)
      expect(logStore.pendingCount).toBe(2)
    })

    it('drops an item and records a failure on a permanent (non-network) error', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      writer.failNextWith = new LogWriteError('rejected by server', false, '23514')

      await logStore.init(writer, queue)

      expect(await queue.count()).toBe(0)
      expect(logStore.failures).toHaveLength(1)
      expect(householdStore.overlay).toHaveLength(0)
    })

    it('does not replay while the writer is not ready (no user session yet)', async () => {
      const { logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      let ready = false
      writer.ready = async () => ready

      await logStore.init(writer, queue)
      await logStore.replay()
      expect(writer.calls).toEqual([])
      expect(await queue.count()).toBe(1)

      ready = true
      await logStore.replay()
      expect(writer.calls).toEqual([dinnerCmd('Pizza')])
      expect(await queue.count()).toBe(0)
    })

    it("replays on the online event even when its listener runs before the household store's", async () => {
      setActivePinia(createPinia())
      const householdStore = useHouseholdStore()
      const logStore = useLogStore()
      const writer = createFakeWriter()
      const queue = createFakeQueue()
      await logStore.init(writer, queue) // registers its online listener first
      await householdStore.start(HOUSEHOLD_ID, fakeSource(buildDemoSnapshot(new Date('2026-09-14T19:00:00Z'))))
      setOnline(false)
      await logStore.submit(dinnerCmd('Pizza'))

      setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(writer.calls).toEqual([dinnerCmd('Pizza')])
      expect(await queue.count()).toBe(0)
      logStore.stop()
    })

    it('overlays restored from the queue on init use the time they were enqueued', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await queue.enqueue(doseCmd('dose-q'))
      const [item] = await queue.list()
      ;(item!.command as { entry: { createdAt: string } }).entry.createdAt = ''
      writer.failAlwaysWith = new LogWriteError('fetch failed', true, null)
      vi.setSystemTime(Date.now() + 5 * 60_000) // the app restarts later

      await logStore.init(writer, queue)

      expect(householdStore.view?.doses.find((d) => d.id === 'dose-q')?.createdAt).toBe(item!.enqueuedAt)
      logStore.stop()
    })

    it('re-adds queued commands to the overlay on init so they display after a reload', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      writer.failNextWith = new LogWriteError('offline', true, null) // stay queued through init's replay

      await logStore.init(writer, queue)

      expect(householdStore.view?.household.dinnerTonight).toBe('Pizza')
    })
  })

  describe('ordering', () => {
    it('a command submitted while an earlier one is queued is queued behind it and executes after it', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      writer.failNextWith = new LogWriteError('fetch failed', true, null)
      expect(await logStore.submit(sleepStartCmd())).toBe('queued')

      const result = await logStore.submit(sleepEndCmd())
      await logStore.replay()

      expect(result).toBe('queued')
      expect(writer.calls.map((c) => c.kind)).toEqual(['sleep.start', 'sleep.start', 'sleep.end'])
      expect(await queue.count()).toBe(0)
      expect(logStore.pendingCount).toBe(0)
      expect(householdStore.view?.sleeps.find((s) => s.id === 'sleep-x')?.endAt).toBe('2026-09-14T19:00:00.000Z')
    })

    it('a command submitted while a replay is in flight is queued and sent after the replay items', async () => {
      const { logStore, writer, queue } = await setup()
      await queue.enqueue(sleepStartCmd())
      writer.failAlwaysWith = new LogWriteError('fetch failed', true, null)
      await logStore.init(writer, queue)
      writer.failAlwaysWith = null

      const gate = deferred()
      writer.gate = gate.promise
      const replaying = logStore.replay()
      const result = await logStore.submit(sleepEndCmd())
      writer.gate = null
      gate.resolve()
      await replaying
      await logStore.replay()

      expect(result).toBe('queued')
      expect(writer.calls.map((c) => c.kind)).toEqual(['sleep.start', 'sleep.start', 'sleep.end'])
      expect(await queue.count()).toBe(0)
    })

    it('a command submitted while a direct send is in flight waits for it instead of overtaking it', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const gate = deferred()
      writer.gate = gate.promise
      writer.failNextWith = new LogWriteError('fetch failed', true, null)

      const first = logStore.submit(sleepStartCmd())
      const second = logStore.submit(sleepEndCmd())
      writer.gate = null
      gate.resolve()

      expect(await first).toBe('queued')
      expect(await second).toBe('queued')
      await logStore.replay()
      expect(writer.calls.map((c) => c.kind)).toEqual(['sleep.start', 'sleep.start', 'sleep.end'])
    })

    it('concurrent replay() calls share one run and execute each queued item once', async () => {
      const { logStore, writer, queue } = await setup()
      await queue.enqueue(dinnerCmd('Pizza'))
      await queue.enqueue(feedingCmd('feed-1'))
      writer.failAlwaysWith = new LogWriteError('fetch failed', true, null)
      await logStore.init(writer, queue)
      writer.failAlwaysWith = null
      writer.calls = []

      const gate = deferred()
      writer.gate = gate.promise
      const a = logStore.replay()
      const b = logStore.replay()
      writer.gate = null
      gate.resolve()
      await Promise.all([a, b])

      expect(writer.calls).toEqual([dinnerCmd('Pizza'), feedingCmd('feed-1')])
      expect(await queue.count()).toBe(0)
    })
  })

  describe('undo', () => {
    it('undo of a queued command that is being sent waits for the send, then submits the inverse', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      writer.failNextWith = new LogWriteError('fetch failed', true, null)
      expect(await logStore.submit(dinnerCmd('Pizza'))).toBe('queued')
      writer.calls = []

      const gate = deferred()
      writer.gate = gate.promise
      const replaying = logStore.replay()
      await Promise.resolve()
      expect(writer.calls).toEqual([dinnerCmd('Pizza')]) // in flight

      const undoing = logStore.undo()
      writer.gate = null
      gate.resolve()
      await replaying
      expect(await undoing).toBe('undone')
      await logStore.replay()

      expect(writer.calls.map((c) => (c as { text: string }).text)).toEqual(['Pizza', 'Tacos'])
      expect(await queue.count()).toBe(0)
      expect(householdStore.view?.household.dinnerTonight).toBe('Tacos')
      expect(logStore.lastAction).toBeNull()
    })

    it('undoes a saved dinner.set by submitting its inverse', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(dinnerCmd('Pizza'))

      const result = await logStore.undo()

      expect(result).toBe('undone')
      expect(householdStore.view?.household.dinnerTonight).toBe('Tacos')
      expect(logStore.lastAction).toBeNull()
    })

    it('undoes a saved feeding.add by deleting the entry', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(feedingCmd('feed-undo'))
      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-undo')).toBe(true)

      await logStore.undo()

      expect(householdStore.view?.feedings.some((f) => f.id === 'feed-undo')).toBe(false)
    })

    it('undoes a saved grocery.add by deleting the item', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      const item = { id: 'grocery-undo', text: 'Eggs', createdAt: '2026-09-14T19:00:00.000Z', checkedAt: null }
      await logStore.submit({ kind: 'grocery.add', householdId: HOUSEHOLD_ID, item, displayId: 'demo-display' })

      await logStore.undo()

      expect(householdStore.view?.groceries.some((g) => g.id === 'grocery-undo')).toBe(false)
    })

    it('removes an unsent queued command directly, without sending an inverse', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)
      await logStore.submit(dinnerCmd('Pizza'))
      expect(await queue.count()).toBe(1)

      const result = await logStore.undo()

      expect(result).toBe('undone')
      expect(await queue.count()).toBe(0)
      expect(householdStore.overlay).toHaveLength(0)
      expect(writer.calls).toEqual([])
    })

    it('dose.add undo returns "needsPin" without submitting anything', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(doseCmd())
      writer.calls = []

      const result = await logStore.undo()

      expect(result).toBe('needsPin')
      expect(writer.calls).toEqual([])
    })

    it('the undo slot expires after 10 seconds', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(dinnerCmd('Pizza'))
      expect(logStore.lastAction).not.toBeNull()

      await vi.advanceTimersByTimeAsync(10_000)

      expect(logStore.lastAction).toBeNull()
    })

    it('extendUndo restarts the undo window with a full 10 seconds, and does nothing when there is no action', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      logStore.extendUndo()
      expect(logStore.lastAction).toBeNull()

      await logStore.submit(dinnerCmd('Pizza'))
      await vi.advanceTimersByTimeAsync(6_000)
      logStore.extendUndo()
      expect(logStore.lastAction?.expiresAt).toBe(Date.now() + 10_000)

      await vi.advanceTimersByTimeAsync(9_900)
      expect(logStore.lastAction).not.toBeNull()
      await vi.advanceTimersByTimeAsync(100)
      expect(logStore.lastAction).toBeNull()
    })

    it('voiding the just-logged dose clears the undo slot instead of offering the void for undo', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(doseCmd('dose-v'))
      expect(logStore.lastAction?.command.kind).toBe('dose.add')

      await logStore.submit({
        kind: 'dose.void', householdId: HOUSEHOLD_ID, doseId: 'dose-v',
        membershipId: 'bbbbbbbb-0000-0000-0000-000000000001', pin: '1234', reason: 'Undone within 10 seconds',
      })

      expect(logStore.lastAction).toBeNull()
    })

    it('acknowledging a dose alert clears the undo slot', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(dinnerCmd('Pizza'))

      await logStore.submit({
        kind: 'dose.acknowledge', householdId: HOUSEHOLD_ID, doseId: 'ffffffff-0000-0000-0000-000000000001',
        membershipId: 'bbbbbbbb-0000-0000-0000-000000000001', pin: '1234',
      })

      expect(logStore.lastAction).toBeNull()
    })
  })

  describe('undoDose', () => {
    const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
    const voidCmd = (doseId: string): Extract<LogCommand, { kind: 'dose.void' }> => ({
      kind: 'dose.void', householdId: HOUSEHOLD_ID, doseId, membershipId: SAM, pin: '1234', reason: 'Undone within 10 seconds',
    })
    const hasDose = (store: ReturnType<typeof useHouseholdStore>, id: string) => store.view?.doses.some((d) => d.id === id) ?? false

    it('removes a dose that is still queued from the queue and the overlay, with no server call and no PIN', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)
      expect(await logStore.submit(doseCmd('dose-q'), { confirmOffline: true })).toBe('queued')
      expect(logStore.isDoseUnsent('dose-q')).toBe(true)
      expect(hasDose(householdStore, 'dose-q')).toBe(true)

      expect(await logStore.undoDose('dose-q', null)).toBe('removed')

      expect(writer.calls).toEqual([])
      expect(await queue.count()).toBe(0)
      expect(logStore.pendingCount).toBe(0)
      expect(hasDose(householdStore, 'dose-q')).toBe(false)
      expect(householdStore.overlay).toHaveLength(0)
      expect(logStore.lastAction).toBeNull()
      expect(logStore.isDoseUnsent('dose-q')).toBe(false)
    })

    it('waits for a dose that is being sent, then voids it', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      setOnline(false)
      await logStore.submit(doseCmd('dose-f'), { confirmOffline: true })
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })

      const gate = deferred()
      writer.gate = gate.promise
      const replaying = logStore.replay()
      await Promise.resolve()
      expect(writer.calls.map((c) => c.kind)).toEqual(['dose.add']) // in flight
      expect(logStore.isDoseUnsent('dose-f')).toBe(false)

      const undoing = logStore.undoDose('dose-f', voidCmd('dose-f'))
      await Promise.resolve()
      expect(writer.calls.map((c) => c.kind)).toEqual(['dose.add']) // not voided before it has landed
      writer.gate = null
      gate.resolve()
      await replaying

      expect(await undoing).toBe('voided')
      expect(writer.calls).toEqual([expect.objectContaining({ kind: 'dose.add' }), voidCmd('dose-f')])
      expect(await queue.count()).toBe(0)
    })

    it('voids a synced dose, and asks for a PIN when none was given', async () => {
      const { logStore, writer, queue } = await setup()
      await logStore.init(writer, queue)
      await logStore.submit(doseCmd('dose-s'))
      expect(logStore.isDoseUnsent('dose-s')).toBe(false)

      expect(await logStore.undoDose('dose-s', null)).toBe('needsPin')
      expect(writer.calls.map((c) => c.kind)).toEqual(['dose.add'])

      expect(await logStore.undoDose('dose-s', voidCmd('dose-s'))).toBe('voided')
      expect(writer.calls.at(-1)).toEqual(voidCmd('dose-s'))
      expect(logStore.lastAction).toBeNull()
    })
  })

  describe('stuck commands', () => {
    const notFound = () => new LogWriteError('Not found yet', true, 'NOT_FOUND')

    /** Fails `sleep.end` for 'sleep-gone' with NOT_FOUND (its sleep was discarded elsewhere); everything else saves. */
    function failGoneSleepEnd(writer: FakeWriter): void {
      writer.execute = async (cmd) => {
        writer.calls.push(cmd)
        if (cmd.kind === 'sleep.end' && cmd.entryId === 'sleep-gone') throw notFound()
      }
    }

    it('drops a command that fails NOT_FOUND more than 5 times over more than 10 minutes, then sends the rest', async () => {
      const { householdStore, logStore, writer, queue } = await setup()
      failGoneSleepEnd(writer)
      await logStore.init(writer, queue)
      setOnline(false)
      await logStore.submit(sleepEndCmd('sleep-gone'))
      await logStore.submit(feedingCmd('feed-1'))
      setOnline(true)
      await vi.advanceTimersByTimeAsync(0) // attempt 1 (online event)

      await vi.advanceTimersByTimeAsync(5 * 30_000) // attempts 2–6, only 2.5 minutes in
      expect(await queue.count()).toBe(2)
      expect(logStore.failures).toEqual([])
      expect(writer.calls.some((c) => c.kind === 'feeding.add')).toBe(false)

      await vi.advanceTimersByTimeAsync(8 * 60_000) // past 10 minutes since the first failure
      expect(await queue.count()).toBe(0)
      expect(logStore.pendingCount).toBe(0)
      expect(logStore.failures).toEqual([STUCK_COMMAND_MESSAGE])
      expect(householdStore.overlay.some((o) => o.command.kind === 'sleep.end')).toBe(false)
      expect(writer.calls.filter((c) => c.kind === 'feeding.add')).toHaveLength(1)
      logStore.stop()
    })

    it('keeps a NOT_FOUND command past 10 minutes until it has failed more than 5 times', async () => {
      const { logStore, writer, queue } = await setup()
      failGoneSleepEnd(writer)
      await queue.enqueue(sleepEndCmd('sleep-gone'))
      await logStore.init(writer, queue) // attempt 1
      logStore.stop()
      vi.setSystemTime(Date.now() + 11 * 60_000)

      for (let i = 2; i <= 5; i++) await logStore.replay()
      expect(await queue.count()).toBe(1)
      expect(logStore.failures).toEqual([])

      await logStore.replay() // attempt 6
      expect(await queue.count()).toBe(0)
      expect(logStore.failures).toEqual([STUCK_COMMAND_MESSAGE])
    })

    it('never drops a command for other retryable errors', async () => {
      const { logStore, writer, queue } = await setup()
      writer.failAlwaysWith = new LogWriteError('fetch failed', true, null)
      await queue.enqueue(dinnerCmd('Pizza'))
      await logStore.init(writer, queue)

      await vi.advanceTimersByTimeAsync(20 * 60_000)

      expect(await queue.count()).toBe(1)
      expect(logStore.failures).toEqual([])
      logStore.stop()
    })

    it('a reload starts the count over', async () => {
      const { logStore, writer, queue } = await setup()
      failGoneSleepEnd(writer)
      await queue.enqueue(sleepEndCmd('sleep-gone'))
      await logStore.init(writer, queue) // attempt 1
      logStore.stop()
      for (let i = 2; i <= 6; i++) await logStore.replay()

      // A reload forgets the counts: after re-init, the 10 minutes and 5 attempts start over.
      vi.setSystemTime(Date.now() + 11 * 60_000)
      await logStore.init(writer, queue)
      logStore.stop()
      for (let i = 2; i <= 6; i++) await logStore.replay()
      expect(await queue.count()).toBe(1)
      expect(logStore.failures).toEqual([])
    })
  })

  describe('verifyPin', () => {
    it("delegates to the writer's PIN check", async () => {
      const { logStore, writer, queue } = await setup()
      const seen: [string, string][] = []
      writer.verifyPin = async (membershipId, pin) => {
        seen.push([membershipId, pin])
        return pin === '1234'
      }
      await logStore.init(writer, queue)

      await expect(logStore.verifyPin('mem-1', '1234')).resolves.toBe(true)
      await expect(logStore.verifyPin('mem-1', '0000')).resolves.toBe(false)
      expect(seen).toEqual([['mem-1', '1234'], ['mem-1', '0000']])
    })

    it('requires init', async () => {
      const { logStore } = await setup()
      expect(() => logStore.verifyPin('mem-1', '1234')).toThrow(/init/)
    })
  })
})
