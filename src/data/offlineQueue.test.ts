import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfflineQueue } from './offlineQueue'
import type { LogCommand } from './logCommands'

let dbName: string
beforeEach(() => {
  // A fresh db name per test avoids cross-test pollution within the shared fake IndexedDB factory.
  dbName = `roost-test-${Math.random().toString(36).slice(2)}`
})

afterEach(() => {
  vi.restoreAllMocks()
})

function dinnerCmd(text: string): LogCommand {
  return { kind: 'dinner.set', householdId: 'h1', text, previous: null }
}

function pinCmd(): LogCommand {
  return { kind: 'dose.void', householdId: 'h1', doseId: 'd1', membershipId: 'm1', pin: '1234', reason: 'test' }
}

describe('createOfflineQueue', () => {
  it('enqueue then list returns items in insertion order', async () => {
    const queue = createOfflineQueue(dbName)
    await queue.enqueue(dinnerCmd('a'))
    await queue.enqueue(dinnerCmd('b'))
    await queue.enqueue(dinnerCmd('c'))

    const items = await queue.list()
    expect(items.map((i) => (i.command as { text: string }).text)).toEqual(['a', 'b', 'c'])
    for (const item of items) {
      expect(typeof item.key).toBe('number')
      expect(typeof item.enqueuedAt).toBe('string')
    }
  })

  it('preserves order across reopening a queue with the same db name', async () => {
    const first = createOfflineQueue(dbName)
    await first.enqueue(dinnerCmd('a'))
    await first.enqueue(dinnerCmd('b'))

    const reopened = createOfflineQueue(dbName)
    const items = await reopened.list()
    expect(items.map((i) => (i.command as { text: string }).text)).toEqual(['a', 'b'])
  })

  it('remove deletes an item by key', async () => {
    const queue = createOfflineQueue(dbName)
    await queue.enqueue(dinnerCmd('a'))
    const key = await queue.enqueue(dinnerCmd('b'))
    await queue.enqueue(dinnerCmd('c'))

    await queue.remove(key)
    const items = await queue.list()
    expect(items.map((i) => (i.command as { text: string }).text)).toEqual(['a', 'c'])
  })

  it('count reflects the number of queued items', async () => {
    const queue = createOfflineQueue(dbName)
    expect(await queue.count()).toBe(0)
    await queue.enqueue(dinnerCmd('a'))
    await queue.enqueue(dinnerCmd('b'))
    expect(await queue.count()).toBe(2)
  })

  it('clear empties the queue', async () => {
    const queue = createOfflineQueue(dbName)
    await queue.enqueue(dinnerCmd('a'))
    await queue.enqueue(dinnerCmd('b'))
    await queue.clear()
    expect(await queue.count()).toBe(0)
    expect(await queue.list()).toEqual([])
  })

  it('rejects enqueue for commands that require a live connection', async () => {
    const queue = createOfflineQueue(dbName)
    await expect(queue.enqueue(pinCmd())).rejects.toThrow()
    expect(await queue.count()).toBe(0)
  })

  describe('robustness', () => {
    it('enqueue resolves only once the transaction commits: an abort after the add succeeded rejects', async () => {
      const queue = createOfflineQueue(dbName)
      await queue.count() // open the db before patching
      const originalAdd = IDBObjectStore.prototype.add
      vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const request = originalAdd.call(this, value, key)
        request.addEventListener('success', () => this.transaction.abort())
        return request
      })

      await expect(queue.enqueue(dinnerCmd('a'))).rejects.toBeDefined()
      vi.restoreAllMocks()
      expect(await queue.count()).toBe(0)
    })

    it('remove and clear reject when their transaction aborts', async () => {
      const queue = createOfflineQueue(dbName)
      const key = await queue.enqueue(dinnerCmd('a'))
      for (const method of ['delete', 'clear'] as const) {
        const original = IDBObjectStore.prototype[method] as (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
        vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
          const request = original.apply(this, args)
          request.addEventListener('success', () => this.transaction.abort())
          return request
        } as never)
      }

      await expect(queue.remove(key)).rejects.toBeDefined()
      await expect(queue.clear()).rejects.toBeDefined()
      vi.restoreAllMocks()
      expect(await queue.count()).toBe(1)
    })

    it('rejects every operation when indexedDB.open throws (e.g. private browsing)', async () => {
      vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('IndexedDB is not available', 'InvalidStateError')
      })
      const queue = createOfflineQueue(dbName)

      await expect(queue.list()).rejects.toThrow('IndexedDB is not available')
      await expect(queue.enqueue(dinnerCmd('a'))).rejects.toThrow()
    })

    it('rejects when the open request fails', async () => {
      vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        const request = { error: new DOMException('denied', 'UnknownError') } as unknown as IDBOpenDBRequest
        setTimeout(() => request.onerror?.(new Event('error')), 0)
        return request
      })
      const queue = createOfflineQueue(dbName)

      await expect(queue.count()).rejects.toThrow('denied')
    })

    it('retries a failed open once (UnknownError), then works', async () => {
      const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
        throw new DOMException('flaky', 'UnknownError')
      })
      const queue = createOfflineQueue(dbName)

      expect(await queue.count()).toBe(0)
      expect(open).toHaveBeenCalledTimes(2)
    })

    it('after an operation fails to open the db, a later operation opens it again', async () => {
      const failing = () => {
        throw new DOMException('not yet', 'UnknownError')
      }
      vi.spyOn(indexedDB, 'open').mockImplementationOnce(failing).mockImplementationOnce(failing)
      const queue = createOfflineQueue(dbName)
      await expect(queue.count()).rejects.toThrow('not yet')

      await queue.enqueue(dinnerCmd('a'))
      expect(await queue.count()).toBe(1)
    })

    it('reopens the connection once and retries when a transaction hits InvalidStateError', async () => {
      const queue = createOfflineQueue(dbName)
      await queue.enqueue(dinnerCmd('a'))
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      })

      await queue.enqueue(dinnerCmd('b'))
      expect((await queue.list()).map((i) => (i.command as { text: string }).text)).toEqual(['a', 'b'])
    })

    it('closes its connection on versionchange so another tab can upgrade the database', async () => {
      const queue = createOfflineQueue(dbName)
      await queue.count()

      const upgraded = await new Promise<string>((resolve) => {
        const request = indexedDB.open(dbName, 2)
        request.onblocked = () => resolve('blocked')
        request.onsuccess = () => {
          request.result.close()
          resolve('opened')
        }
      })

      expect(upgraded).toBe('opened')
    })
  })
})
