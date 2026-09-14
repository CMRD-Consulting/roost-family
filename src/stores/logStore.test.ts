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
import { NeedsOfflineDoseConfirmation, useLogStore } from './logStore'

function fakeSource(snapshot: HouseholdSnapshot): HouseholdSource {
  return {
    async load() {
      return snapshot
    },
    subscribe() {
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

async function setup() {
  setActivePinia(createPinia())
  const now = new Date('2026-09-14T19:00:00Z')
  const snapshot = buildDemoSnapshot(now)
  const householdStore = useHouseholdStore()
  await householdStore.start(HOUSEHOLD_ID, fakeSource(snapshot))
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
  })
})
