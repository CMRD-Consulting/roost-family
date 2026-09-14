import { toRaw } from 'vue'
import type { DisplayIdentity } from '@/session/displaySession'
import type { HouseholdSnapshot } from './snapshot'

const STORE = 'kv'
const VERSION = 1
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const IDENTITY_KEY = 'identity'

export interface DeviceCache {
  saveSnapshot(snapshot: HouseholdSnapshot): Promise<void>
  /** Null when nothing is cached for this household, or the cached copy is more than 7 days old. */
  loadSnapshot(householdId: string): Promise<HouseholdSnapshot | null>
  saveIdentity(identity: DisplayIdentity): Promise<void>
  loadIdentity(): Promise<DisplayIdentity | null>
  clear(): Promise<void>
}

function snapshotKey(householdId: string): string {
  return `snapshot:${householdId}`
}

/** Round-trips through JSON so a possibly-reactive value is stored as a plain, structured-clone-safe copy. */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}

/** Opens the db. `onClosed` runs when the connection goes away (another tab upgrading, or the browser closing it). */
function openDb(dbName: string, onClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, VERSION)
    let settled = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
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
      reject(new DOMException('The device cache is blocked by another open tab.', 'UnknownError'))
    }
  })
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(request.error ?? tx.error)
    tx.onabort = () => reject(tx.error ?? request.error ?? new DOMException('The transaction was aborted.', 'AbortError'))
  })
}

/**
 * A last-known-good cache of one household's data and this device's display identity, so a
 * registered tablet can boot straight to its last screen with no network (spec §13).
 *
 * Deliberately its own IndexedDB database (separate from the offline queue's `roost` db): clearing
 * one on revoke/unregister/start-over must never touch the other's pending writes.
 *
 * If IndexedDB can't be opened at all (e.g. private browsing), every method degrades to a no-op /
 * null instead of throwing, so a display that can't cache still boots and runs live.
 */
export function createDeviceCache(dbName = 'roost-cache'): DeviceCache {
  let dbPromise: Promise<IDBDatabase> | null = null
  let warned = false

  function getDb(): Promise<IDBDatabase> {
    if (dbPromise === null) {
      const opening: Promise<IDBDatabase> = openDb(dbName, () => {
        if (dbPromise === opening) dbPromise = null
      }).catch((e: unknown) => {
        // A failed open isn't cached: the next operation tries again.
        if (dbPromise === opening) dbPromise = null
        if (!warned) {
          warned = true
          console.warn('Device cache unavailable; continuing without it.', e)
        }
        throw e
      })
      dbPromise = opening
    }
    return dbPromise
  }

  /** Drops the current connection so the next operation opens a fresh one. */
  async function resetConnection(): Promise<void> {
    const current = dbPromise
    dbPromise = null
    if (current) (await current.catch(() => null))?.close()
  }

  /**
   * Runs one transaction. A failure on an open connection (closed under us: InvalidStateError; a transient
   * browser failure: UnknownError; an aborted or failed transaction) resets the connection and retries once.
   * Anything still failing (including "can't open the db at all") degrades to `fallback`.
   */
  async function transact<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
    let db: IDBDatabase
    try {
      db = await getDb()
    } catch {
      return fallback
    }
    try {
      return await runTransaction(db, mode, fn)
    } catch {
      await resetConnection()
    }
    try {
      return await runTransaction(await getDb(), mode, fn)
    } catch {
      return fallback
    }
  }

  async function put(key: string, value: unknown): Promise<void> {
    await transact<IDBValidKey>('readwrite', (s) => s.put(deepCopy(value), key), key)
  }

  async function get<T>(key: string): Promise<T | null> {
    const result = await transact<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>, undefined)
    return result ?? null
  }

  async function saveSnapshot(snapshot: HouseholdSnapshot): Promise<void> {
    await put(snapshotKey(snapshot.household.id), snapshot)
  }

  async function loadSnapshot(householdId: string): Promise<HouseholdSnapshot | null> {
    const snapshot = await get<HouseholdSnapshot>(snapshotKey(householdId))
    if (snapshot === null) return null
    // Stale medicine timing is worse than none: an old snapshot is treated as absent.
    if (Date.now() - Date.parse(snapshot.loadedAt) > MAX_SNAPSHOT_AGE_MS) return null
    return snapshot
  }

  async function saveIdentity(identity: DisplayIdentity): Promise<void> {
    await put(IDENTITY_KEY, identity)
  }

  async function loadIdentity(): Promise<DisplayIdentity | null> {
    return get<DisplayIdentity>(IDENTITY_KEY)
  }

  async function clear(): Promise<void> {
    await transact('readwrite', (s) => s.clear(), undefined)
  }

  return { saveSnapshot, loadSnapshot, saveIdentity, loadIdentity, clear }
}
