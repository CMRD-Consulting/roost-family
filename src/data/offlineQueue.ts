import { requiresOnline, type LogCommand } from './logCommands'

const STORE = 'pending'
const VERSION = 1

export interface QueuedCommand {
  key: number
  command: LogCommand
  enqueuedAt: string
}

export interface OfflineQueue {
  enqueue(cmd: LogCommand): Promise<number>
  list(): Promise<QueuedCommand[]>
  remove(key: number): Promise<void>
  count(): Promise<number>
  clear(): Promise<void>
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** An IndexedDB-backed FIFO queue of pending log commands, one object store ("pending") per db. */
export function createOfflineQueue(dbName = 'roost'): OfflineQueue {
  const dbPromise = openDb(dbName)

  async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await dbPromise
    return db.transaction(STORE, mode).objectStore(STORE)
  }

  async function enqueue(cmd: LogCommand): Promise<number> {
    if (requiresOnline(cmd)) {
      throw new Error(`Command "${cmd.kind}" requires a live connection and cannot be queued offline.`)
    }
    const s = await store('readwrite')
    const record = { command: cmd, enqueuedAt: new Date().toISOString() }
    return promisifyRequest(s.add(record) as IDBRequest<number>)
  }

  async function list(): Promise<QueuedCommand[]> {
    const s = await store('readonly')
    return new Promise((resolve, reject) => {
      const items: QueuedCommand[] = []
      const request = s.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          items.push(cursor.value as QueuedCommand)
          cursor.continue()
        } else {
          resolve(items)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async function remove(key: number): Promise<void> {
    const s = await store('readwrite')
    await promisifyRequest(s.delete(key))
  }

  async function count(): Promise<number> {
    const s = await store('readonly')
    return promisifyRequest(s.count())
  }

  async function clear(): Promise<void> {
    const s = await store('readwrite')
    await promisifyRequest(s.clear())
  }

  return { enqueue, list, remove, count, clear }
}
