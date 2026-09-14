import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import type { HouseholdSnapshot } from '@/data/snapshot'
import type { HouseholdSource } from '@/data/householdSource'
import { useHouseholdStore } from './householdStore'

function fakeSource(loadImpl?: (id: string, now: Date) => Promise<HouseholdSnapshot>) {
  let onChangeCb: (() => void) | null = null
  const unsubscribe = vi.fn()
  const load = vi.fn(loadImpl ?? (async (_id: string, now: Date) => buildDemoSnapshot(now)))
  const subscribe = vi.fn((_id: string, cb: () => void) => {
    onChangeCb = cb
    return unsubscribe
  })
  const source: HouseholdSource = { load, subscribe }
  return { source, load, subscribe, unsubscribe, triggerChange: () => onChangeCb?.() }
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
    expect(subscribe).toHaveBeenCalledWith('h1', expect.any(Function))
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
})
