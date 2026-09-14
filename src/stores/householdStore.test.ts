import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import type { HouseholdSource } from '@/data/householdSource'
import type { LogCommand } from '@/data/logCommands'
import { useHouseholdStore } from './householdStore'

function fakeSource(loadImpl?: (id: string, now: Date) => Promise<HouseholdSnapshot>) {
  let onChangeCb: (() => void) | null = null
  let onStatusCb: ((status: 'connected' | 'disconnected') => void) | null = null
  const unsubscribe = vi.fn()
  const load = vi.fn(loadImpl ?? (async (_id: string, now: Date) => buildDemoSnapshot(now)))
  const subscribe = vi.fn((_id: string, cb: () => void, onStatus?: (status: 'connected' | 'disconnected') => void) => {
    onChangeCb = cb
    onStatusCb = onStatus ?? null
    return unsubscribe
  })
  const source: HouseholdSource = { load, subscribe }
  return {
    source,
    load,
    subscribe,
    unsubscribe,
    triggerChange: () => onChangeCb?.(),
    triggerStatus: (status: 'connected' | 'disconnected') => onStatusCb?.(status),
  }
}

/** A source whose `load` calls resolve only when the test tells them to, in any order. */
function deferredSource() {
  const resolvers = new Map<number, (s: HouseholdSnapshot) => void>()
  let callIndex = 0
  const subscribe = vi.fn((_id: string, _cb: () => void) => vi.fn())
  const load = vi.fn((_id: string, _now: Date) => {
    const index = callIndex++
    return new Promise<HouseholdSnapshot>((resolve) => {
      resolvers.set(index, resolve)
    })
  })
  const source: HouseholdSource = { load, subscribe }
  return {
    source,
    load,
    subscribe,
    resolve: (index: number, snapshot: HouseholdSnapshot) => resolvers.get(index)?.(snapshot),
  }
}

let stores: ReturnType<typeof useHouseholdStore>[] = []
function newStore() {
  const s = useHouseholdStore()
  stores.push(s)
  return s
}

describe('useHouseholdStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stores = []
  })

  afterEach(() => {
    for (const s of stores) s.stop()
    stores = []
  })

  it('loads and subscribes on start', async () => {
    const { source, load, subscribe } = fakeSource()
    const store = newStore()
    await store.start('h1', source)

    expect(load).toHaveBeenCalledWith('h1', expect.any(Date))
    expect(subscribe).toHaveBeenCalledWith('h1', expect.any(Function), expect.any(Function))
    expect(store.status).toBe('ready')
    expect(store.snapshot).not.toBeNull()
    expect(store.error).toBeNull()
  })

  it('is idempotent for the same household', async () => {
    const { source, load, subscribe } = fakeSource()
    const store = newStore()
    await store.start('h1', source)
    await store.start('h1', source)

    expect(load).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('reloads when the source signals a change', async () => {
    const { source, load, triggerChange } = fakeSource()
    const store = newStore()
    await store.start('h1', source)
    load.mockClear()

    triggerChange()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('keeps the previous snapshot on reload failure and only errors status when there was none', async () => {
    let shouldFail = false
    const { source } = fakeSource(async (_id, now) => {
      if (shouldFail) throw new Error('offline')
      return buildDemoSnapshot(now)
    })
    const store = newStore()
    await store.start('h1', source)
    const firstSnapshot = store.snapshot
    expect(store.status).toBe('ready')

    shouldFail = true
    await store.reload()

    expect(store.snapshot).toBe(firstSnapshot)
    expect(store.status).toBe('ready')
    expect(store.error).toBe('offline')
  })

  it('sets status to error when the initial load fails with no prior snapshot', async () => {
    const { source } = fakeSource(async () => {
      throw new Error('down')
    })
    const store = newStore()
    await store.start('h1', source)

    expect(store.snapshot).toBeNull()
    expect(store.status).toBe('error')
    expect(store.error).toBe('down')
  })

  it('unsubscribes and removes listeners on stop', async () => {
    const { source, unsubscribe } = fakeSource()
    const store = newStore()
    await store.start('h1', source)

    store.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reloads when connectivity returns online', async () => {
    const { source, load } = fakeSource()
    const store = newStore()
    await store.start('h1', source)
    load.mockClear()

    window.dispatchEvent(new Event('online'))
    expect(store.online).toBe(true)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('sets online to false on an offline event', async () => {
    const { source } = fakeSource()
    const store = newStore()
    await store.start('h1', source)

    window.dispatchEvent(new Event('offline'))
    expect(store.online).toBe(false)
  })

  it('staleMinutes is 0 with no snapshot and minutes since loadedAt otherwise', async () => {
    const store = newStore()
    expect(store.staleMinutes(new Date())).toBe(0)

    const now = new Date('2026-09-14T19:00:00Z')
    const { source } = fakeSource(async () => buildDemoSnapshot(now))
    await store.start('h1', source)

    expect(store.staleMinutes(new Date(now.getTime() + 7 * 60_000))).toBe(7)
  })

  describe('freshness', () => {
    it('realtime starts unknown and updates as the source reports status', async () => {
      const { source, triggerStatus } = fakeSource()
      const store = newStore()
      expect(store.realtime).toBe('unknown')

      await store.start('h1', source)
      expect(store.realtime).toBe('unknown')

      triggerStatus('connected')
      expect(store.realtime).toBe('connected')

      triggerStatus('disconnected')
      expect(store.realtime).toBe('disconnected')
    })

    it('staleMinutes is always 0 while connected, regardless of how old the last load was', async () => {
      const now = new Date('2026-09-14T19:00:00Z')
      const { source, triggerStatus } = fakeSource(async () => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source)
      triggerStatus('connected')

      expect(store.staleMinutes(new Date(now.getTime() + 45 * 60_000))).toBe(0)
    })

    it('staleMinutes counts minutes since the last successful load while disconnected', async () => {
      const now = new Date('2026-09-14T19:00:00Z')
      const { source, triggerStatus } = fakeSource(async () => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source)
      triggerStatus('disconnected')

      expect(store.staleMinutes(new Date(now.getTime() + 12 * 60_000))).toBe(12)
    })
  })

  describe('midnight reload', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-14T19:00:00Z')) // 3pm EDT; demo household tz is America/New_York
    })
    afterEach(() => vi.useRealTimers())

    it('reloads right at the household\'s next local midnight, not before', async () => {
      const { source, load } = fakeSource(async (_id, now) => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source)
      load.mockClear()

      const msToMidnight = Date.parse('2026-09-15T04:00:00.000Z') - Date.now() // next local midnight
      await vi.advanceTimersByTimeAsync(msToMidnight - 1_000)
      expect(load).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1_000)
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('reschedules for the following midnight after firing', async () => {
      const { source, load } = fakeSource(async (_id, now) => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source)
      load.mockClear()

      const msToFirstMidnight = Date.parse('2026-09-15T04:00:00.000Z') - Date.now()
      await vi.advanceTimersByTimeAsync(msToFirstMidnight)
      expect(load).toHaveBeenCalledTimes(1)

      const msToSecondMidnight = 24 * 3_600_000
      await vi.advanceTimersByTimeAsync(msToSecondMidnight - 1_000)
      expect(load).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(load).toHaveBeenCalledTimes(2)
    })

    it('clears the midnight timer on stop, so it never fires', async () => {
      const { source, load } = fakeSource(async (_id, now) => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source)
      load.mockClear()
      store.stop()

      await vi.advanceTimersByTimeAsync(25 * 3_600_000)
      expect(load).not.toHaveBeenCalled()
    })
  })

  describe('races', () => {
    it('ignores an out-of-order response: an older request resolving after a newer one is dropped', async () => {
      const { source, resolve } = deferredSource()
      const store = newStore()

      const startPromise = store.start('h1', source)
      // A reload fired in between (e.g. a subscribe callback) starts a second, newer load.
      const secondReload = store.reload()

      const older = buildDemoSnapshot(new Date('2026-09-14T19:00:00Z'))
      const newer = buildDemoSnapshot(new Date('2026-09-14T20:00:00Z'))

      // Newer (index 1) resolves first, older (index 0) resolves after it.
      resolve(1, newer)
      await secondReload
      resolve(0, older)
      await startPromise

      // Vue wraps the assigned snapshot in a reactive proxy, so compare identity
      // via a distinguishing field rather than `toBe`.
      expect(store.snapshot?.loadedAt).toBe(newer.loadedAt)
    })

    it('stopping during the first load results in no subscription and no listeners added', async () => {
      const { source, resolve, subscribe } = deferredSource()
      const store = newStore()
      const addSpy = vi.spyOn(window, 'addEventListener')

      const startPromise = store.start('h1', source)
      store.stop()
      resolve(0, buildDemoSnapshot(new Date()))
      await startPromise

      expect(subscribe).not.toHaveBeenCalled()
      expect(addSpy).not.toHaveBeenCalledWith('online', expect.any(Function))
      expect(addSpy).not.toHaveBeenCalledWith('offline', expect.any(Function))
      addSpy.mockRestore()
    })

    it('switching households clears the snapshot and error', async () => {
      const now = new Date('2026-09-14T19:00:00Z')
      const { source: source1 } = fakeSource(async () => buildDemoSnapshot(now))
      const store = newStore()
      await store.start('h1', source1)
      expect(store.snapshot).not.toBeNull()

      const { source: source2 } = fakeSource(async () => {
        throw new Error('nope')
      })
      // Start switching households: the snapshot/error should clear immediately,
      // before the new load even resolves.
      const switching = store.start('h2', source2)
      expect(store.snapshot).toBeNull()
      expect(store.error).toBeNull()

      await switching
      expect(store.error).toBe('nope')
    })

    it('stop resets realtime to unknown', async () => {
      const { source, triggerStatus } = fakeSource()
      const store = newStore()
      await store.start('h1', source)
      triggerStatus('connected')
      expect(store.realtime).toBe('connected')

      store.stop()
      expect(store.realtime).toBe('unknown')
    })

    it('stop removes the online listener', async () => {
      const { source } = fakeSource()
      const store = newStore()
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      await store.start('h1', source)

      store.stop()

      expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
      expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function))
      removeSpy.mockRestore()
    })
  })

  describe('overlay', () => {
    function dinnerCmd(householdId: string, text: string): LogCommand {
      return { kind: 'dinner.set', householdId, text, previous: null }
    }

    it('view is null before any snapshot has loaded', () => {
      const store = newStore()
      expect(store.view).toBeNull()
    })

    it('view applies overlay commands on top of the snapshot, without mutating it', async () => {
      const { source } = fakeSource()
      const store = newStore()
      await store.start('h1', source)

      const cmd = dinnerCmd(store.snapshot!.household.id, 'Pizza')
      store.addOverlay(cmd)

      expect(store.view?.household.dinnerTonight).toBe('Pizza')
      expect(store.snapshot?.household.dinnerTonight).not.toBe('Pizza')
    })

    it('removeOverlay drops a command from the overlay', async () => {
      const { source } = fakeSource()
      const store = newStore()
      await store.start('h1', source)

      const cmd = dinnerCmd(store.snapshot!.household.id, 'Pizza')
      store.addOverlay(cmd)
      store.removeOverlay(cmd)

      expect(store.overlay).toHaveLength(0)
      expect(store.view?.household.dinnerTonight).not.toBe('Pizza')
    })

    it('keeps overlay items that have not been saved across a reload', async () => {
      const { source } = fakeSource()
      const store = newStore()
      await store.start('h1', source)

      const cmd = dinnerCmd(store.snapshot!.household.id, 'Pizza')
      store.addOverlay(cmd)

      await store.reload()

      expect(store.overlay).toHaveLength(1)
      expect(store.view?.household.dinnerTonight).toBe('Pizza')
    })

    it('drops overlay items saved before a later reload starts', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
        const { source } = fakeSource()
        const store = newStore()
        await store.start('h1', source)

        const cmd = dinnerCmd(store.snapshot!.household.id, 'Pizza')
        store.addOverlay(cmd)
        store.markSaved(cmd)

        vi.setSystemTime(new Date('2026-09-14T19:05:00Z'))
        await store.reload()

        expect(store.overlay).toHaveLength(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps overlay items saved after the reload started', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
        const { source } = fakeSource()
        const store = newStore()
        await store.start('h1', source)

        const cmd = dinnerCmd(store.snapshot!.household.id, 'Pizza')
        store.addOverlay(cmd)

        // Saved with a savedAt timestamp equal to or after the reload's own start time.
        const reloadPromise = store.reload()
        store.markSaved(cmd)
        await reloadPromise

        expect(store.overlay).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('applies each overlay command with the time it was added, so the view is stable across recomputes', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
        const { source } = fakeSource()
        const store = newStore()
        await store.start('h1', source)
        const base = store.snapshot!.doses[0]!
        const dose: LogCommand = {
          kind: 'dose.add',
          householdId: store.snapshot!.household.id,
          entry: { ...base, id: 'dose-new', createdAt: '' },
          attribution: { displayId: null, loggedByMembershipId: null, sitterSessionId: null, loggedByName: 'Sam' },
        }
        store.addOverlay(dose)
        expect(store.view?.doses.find((d) => d.id === 'dose-new')?.createdAt).toBe('2026-09-14T19:00:00.000Z')

        vi.setSystemTime(new Date('2026-09-14T19:07:00Z'))
        store.addOverlay(dinnerCmd(store.snapshot!.household.id, 'Pizza')) // forces the view to recompute

        expect(store.view?.household.dinnerTonight).toBe('Pizza')
        expect(store.view?.doses.find((d) => d.id === 'dose-new')?.createdAt).toBe('2026-09-14T19:00:00.000Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('addOverlay accepts an explicit time (e.g. when a queued command was enqueued)', async () => {
      const { source } = fakeSource()
      const store = newStore()
      await store.start('h1', source)
      const householdId = store.snapshot!.household.id
      const doseId = store.snapshot!.doses[0]!.id

      store.addOverlay({ kind: 'dose.void', householdId, doseId, membershipId: 'm1', pin: '1234', reason: 'x' }, new Date('2026-09-14T18:00:00Z'))

      expect(store.view?.doses.find((d) => d.id === doseId)?.voidedAt).toBe('2026-09-14T18:00:00.000Z')
    })

    it('keeps the overlay when restarting the same household after stop, and clears it for a different household', async () => {
      const { source } = fakeSource()
      const store = newStore()
      await store.start('h1', source)
      store.addOverlay(dinnerCmd(store.snapshot!.household.id, 'Pizza'))

      store.stop()
      await store.start('h1', source)
      expect(store.overlay).toHaveLength(1)
      expect(store.view?.household.dinnerTonight).toBe('Pizza')

      store.stop()
      await store.start('h2', source)
      expect(store.overlay).toHaveLength(0)
    })
  })
})
