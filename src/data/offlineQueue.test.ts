import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createOfflineQueue } from './offlineQueue'
import type { LogCommand } from './logCommands'

let dbName: string
beforeEach(() => {
  // A fresh db name per test avoids cross-test pollution within the shared fake IndexedDB factory.
  dbName = `roost-test-${Math.random().toString(36).slice(2)}`
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
})
