import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisplayIdentity } from '@/session/displaySession'
import { createDeviceCache } from './deviceCache'
import type { HouseholdSnapshot } from './snapshot'

let dbName: string
beforeEach(() => {
  // A fresh db name per test avoids cross-test pollution within the shared fake IndexedDB factory.
  dbName = `roost-cache-test-${Math.random().toString(36).slice(2)}`
})

afterEach(() => {
  vi.restoreAllMocks()
})

const IDENTITY: DisplayIdentity = { displayId: 'd1', householdId: 'h1', name: 'Kitchen' }

function fixture(householdId: string, loadedAt: string): HouseholdSnapshot {
  return {
    household: {
      id: householdId,
      name: 'Rivera',
      timeZone: 'America/New_York',
      defaultNightSleep: { start: '19:00', end: '07:00' },
      nightMode: { start: '19:00', end: '07:00' },
      leaveByBufferMin: 15,
      diaperLogEnabled: true,
      dinnerTonight: null,
    },
    members: [],
    children: [],
    medicines: [],
    doses: [],
    sleeps: [],
    feedings: [],
    diapers: [],
    stickerCategories: [],
    stickers: [],
    routines: [],
    routineProgress: [],
    routineOverrides: [],
    jots: [],
    groceries: [],
    activeSitterSession: null,
    loadedAt,
  }
}

describe('createDeviceCache', () => {
  it('round-trips a snapshot', async () => {
    const cache = createDeviceCache(dbName)
    const snapshot = fixture('h1', new Date().toISOString())
    await cache.saveSnapshot(snapshot)

    expect(await cache.loadSnapshot('h1')).toEqual(snapshot)
  })

  it('round-trips a display identity', async () => {
    const cache = createDeviceCache(dbName)
    await cache.saveIdentity(IDENTITY)

    expect(await cache.loadIdentity()).toEqual(IDENTITY)
  })

  it('returns null for a household with no cached snapshot', async () => {
    const cache = createDeviceCache(dbName)
    expect(await cache.loadSnapshot('unknown')).toBeNull()
  })

  it('returns null when no identity has been saved', async () => {
    const cache = createDeviceCache(dbName)
    expect(await cache.loadIdentity()).toBeNull()
  })

  it('isolates snapshots per household', async () => {
    const cache = createDeviceCache(dbName)
    const now = new Date().toISOString()
    await cache.saveSnapshot(fixture('h1', now))
    await cache.saveSnapshot(fixture('h2', now))

    expect((await cache.loadSnapshot('h1'))?.household.id).toBe('h1')
    expect((await cache.loadSnapshot('h2'))?.household.id).toBe('h2')
  })

  it('clear removes both snapshots and the identity', async () => {
    const cache = createDeviceCache(dbName)
    await cache.saveSnapshot(fixture('h1', new Date().toISOString()))
    await cache.saveIdentity(IDENTITY)

    await cache.clear()

    expect(await cache.loadSnapshot('h1')).toBeNull()
    expect(await cache.loadIdentity()).toBeNull()
  })

  it('treats a snapshot older than 7 days as absent', async () => {
    const cache = createDeviceCache(dbName)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    await cache.saveSnapshot(fixture('h1', eightDaysAgo))

    expect(await cache.loadSnapshot('h1')).toBeNull()
  })

  it('keeps a snapshot just under 7 days old', async () => {
    const cache = createDeviceCache(dbName)
    const almostSevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 60_000)).toISOString()
    await cache.saveSnapshot(fixture('h1', almostSevenDaysAgo))

    expect(await cache.loadSnapshot('h1')).not.toBeNull()
  })

  it('degrades to no-ops and logs once when indexedDB cannot open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const request = {
        onerror: null as (() => void) | null,
        onsuccess: null,
        onupgradeneeded: null,
        onblocked: null,
        error: new DOMException('nope', 'InvalidStateError'),
      } as unknown as IDBOpenDBRequest
      queueMicrotask(() => request.onerror?.(new Event('error') as never))
      return request
    })

    const cache = createDeviceCache(dbName)
    await expect(cache.saveSnapshot(fixture('h1', new Date().toISOString()))).resolves.toBeUndefined()
    expect(await cache.loadSnapshot('h1')).toBeNull()
    await expect(cache.saveIdentity(IDENTITY)).resolves.toBeUndefined()
    expect(await cache.loadIdentity()).toBeNull()
    await expect(cache.clear()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    openSpy.mockRestore()
  })

  describe('connection recovery', () => {
    /** Wraps indexedDB.open so the test can reach each connection it opened. */
    function trackOpens() {
      const realOpen = indexedDB.open.bind(indexedDB)
      const connections: IDBDatabase[] = []
      const spy = vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
        const request = realOpen(name, version)
        request.addEventListener('success', () => connections.push(request.result))
        return request
      })
      return { spy, connections }
    }

    it('reopens and retries once when the connection was closed under it (InvalidStateError)', async () => {
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)
      const { spy } = trackOpens()
      const realTransaction = IDBDatabase.prototype.transaction
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      }).mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        return realTransaction.apply(this, args)
      })

      expect(await cache.loadIdentity()).toEqual(IDENTITY)
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('reopens and retries once after an UnknownError', async () => {
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)
      const realTransaction = IDBDatabase.prototype.transaction
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
        throw new DOMException('Internal error.', 'UnknownError')
      }).mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        return realTransaction.apply(this, args)
      })

      expect(await cache.loadIdentity()).toEqual(IDENTITY)
    })

    it('reopens and retries once when a transaction aborts', async () => {
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)
      const realTransaction = IDBDatabase.prototype.transaction
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        const tx = realTransaction.apply(this, args)
        queueMicrotask(() => tx.abort())
        return tx
      }).mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        return realTransaction.apply(this, args)
      })

      const other = fixture('h1', new Date().toISOString())
      await cache.saveSnapshot(other)
      expect(await cache.loadSnapshot('h1')).toEqual(other)
    })

    it('falls back when the retry fails too, and recovers on the next call', async () => {
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)
      const realTransaction = IDBDatabase.prototype.transaction
      const failing = () => {
        throw new DOMException('closing', 'InvalidStateError')
      }
      vi.spyOn(IDBDatabase.prototype, 'transaction')
        .mockImplementationOnce(failing)
        .mockImplementationOnce(failing)
        .mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
          return realTransaction.apply(this, args)
        })

      expect(await cache.loadIdentity()).toBeNull()
      expect(await cache.loadIdentity()).toEqual(IDENTITY)
    })

    it('opens a fresh connection after the browser closes the current one', async () => {
      const { spy, connections } = trackOpens()
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)
      expect(spy).toHaveBeenCalledTimes(1)

      // The browser closing a connection abnormally fires `close` on it.
      connections[0]!.close()
      connections[0]!.onclose?.(new Event('close'))

      expect(await cache.loadIdentity()).toEqual(IDENTITY)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('steps aside when another tab upgrades the database', async () => {
      const cache = createDeviceCache(dbName)
      await cache.saveIdentity(IDENTITY)

      const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 2)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('blocked by the device cache'))
      })
      upgraded.close()
    })
  })
})
