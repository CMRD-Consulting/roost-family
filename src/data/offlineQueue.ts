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

/** Errors after which a fresh connection may succeed (connection closed under us, transient browser failure). */
function isReopenable(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'InvalidStateError' || e.name === 'UnknownError')
}

/** Opens the db. `onClosed` runs when the connection goes away (another tab upgrading, or the browser closing it). */
function openDb(dbName: string, onClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, VERSION)
    let settled = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true })
    }
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        // We already gave up on this open (it was blocked); don't leak the late connection.
        db.close()
        return
      }
      settled = true
      db.onversionchange = () => {
        // Another tab wants to upgrade: step aside instead of blocking it. The next operation reopens.
        db.close()
        onClosed()
      }
      db.onclose = onClosed
      resolve(db)
    }
    request.onerror = () => {
      settled = true
      reject(request.error)
    }
    request.onblocked = () => {
      settled = true
      reject(new DOMException('The offline queue is blocked by another open tab.', 'UnknownError'))
    }
  })
}

/** An IndexedDB-backed FIFO queue of pending log commands, one object store ("pending") per db. */
export function createOfflineQueue(dbName = 'roost'): OfflineQueue {
  let dbPromise: Promise<IDBDatabase> | null = null

  function getDb(): Promise<IDBDatabase> {
    if (dbPromise === null) {
      const opening = openDb(dbName, () => {
        if (dbPromise === opening) dbPromise = null
      })
      dbPromise = opening
      // A failed open isn't cached: the next operation tries again.
      opening.catch(() => {
        if (dbPromise === opening) dbPromise = null
      })
    }
    return dbPromise
  }

  async function resetConnection(): Promise<void> {
    const current = dbPromise
    dbPromise = null
    if (current) (await current.catch(() => null))?.close()
  }

  /** Runs one transaction; resolves with the request's result only once the transaction has committed. */
  function runTransaction<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(request.error ?? tx.error)
      tx.onabort = () => reject(tx.error ?? request.error ?? new DOMException('The transaction was aborted.', 'AbortError'))
    })
  }

  async function transact<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
      return await runTransaction(await getDb(), mode, fn)
    } catch (e) {
      if (!isReopenable(e)) throw e
      await resetConnection()
      return runTransaction(await getDb(), mode, fn)
    }
  }

  async function enqueue(cmd: LogCommand): Promise<number> {
    if (requiresOnline(cmd)) {
      throw new Error(`Command "${cmd.kind}" requires a live connection and cannot be queued offline.`)
    }
    const record = { command: cmd, enqueuedAt: new Date().toISOString() }
    return transact('readwrite', (s) => s.add(record) as IDBRequest<number>)
  }

  async function list(): Promise<QueuedCommand[]> {
    // getAll returns records in key order, i.e. insertion order.
    return transact('readonly', (s) => s.getAll() as IDBRequest<QueuedCommand[]>)
  }

  async function remove(key: number): Promise<void> {
    await transact('readwrite', (s) => s.delete(key))
  }

  async function count(): Promise<number> {
    return transact('readonly', (s) => s.count())
  }

  async function clear(): Promise<void> {
    await transact('readwrite', (s) => s.clear())
  }

  return { enqueue, list, remove, count, clear }
}
