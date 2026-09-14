import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  IDLE_BEFORE_RELOAD_MS,
  checkForUpdate,
  createVersionFetcher,
  isSafeReloadMoment,
  recoverFromChunkError,
  useAppUpdatesStore,
} from './appUpdates'

const idle = { nightActive: false, msSinceLastTouch: IDLE_BEFORE_RELOAD_MS, timerRunning: false, route: '/home' }

describe('isSafeReloadMoment', () => {
  it('is safe after 5 minutes without a touch on the main screen', () => {
    expect(isSafeReloadMoment(idle)).toBe(true)
  })

  it('is not safe before 5 minutes without a touch', () => {
    expect(isSafeReloadMoment({ ...idle, msSinceLastTouch: IDLE_BEFORE_RELOAD_MS - 1 })).toBe(false)
  })

  it('is not safe while Kids\' Corner is open, however long it has been idle', () => {
    expect(isSafeReloadMoment({ ...idle, route: '/corner', msSinceLastTouch: 60 * 60_000 })).toBe(false)
  })

  it('is not safe while a visual timer is running', () => {
    expect(isSafeReloadMoment({ ...idle, timerRunning: true })).toBe(false)
  })

  it('is safe whenever Night Mode is active, even just after a touch or in Kids\' Corner', () => {
    expect(isSafeReloadMoment({ ...idle, nightActive: true, msSinceLastTouch: 0 })).toBe(true)
    expect(isSafeReloadMoment({ ...idle, nightActive: true, msSinceLastTouch: 0, route: '/corner' })).toBe(true)
  })

  it('never interrupts a running visual timer, even in Night Mode', () => {
    expect(isSafeReloadMoment({ ...idle, nightActive: true, timerRunning: true })).toBe(false)
  })

  it('a critical update reloads at once, even just after a touch or in Kids\' Corner', () => {
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: 0 })).toBe(true)
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: 0, route: '/corner' })).toBe(true)
  })

  it('never reloads a public page (Manage household, the Take list) on its own, even in Night Mode or when critical', () => {
    expect(isSafeReloadMoment({ ...idle, route: '/manage', publicRoute: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, route: '/manage', publicRoute: true, nightActive: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, route: '/list/abc', publicRoute: true, critical: true, msSinceLastTouch: 0 })).toBe(false)
  })

  it('never lets a critical update interrupt a running visual timer', () => {
    expect(isSafeReloadMoment({ ...idle, critical: true, timerRunning: true })).toBe(false)
  })
})

describe('useAppUpdatesStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with no update waiting and no timer running', () => {
    const store = useAppUpdatesStore()
    expect(store.waiting).toBe(false)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: IDLE_BEFORE_RELOAD_MS, route: '/home' })).toBe(true)
  })

  it('canReload is false while a screen reports a running timer', () => {
    const store = useAppUpdatesStore()
    store.setTimerRunning(true)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: IDLE_BEFORE_RELOAD_MS, route: '/home' })).toBe(false)
    store.setTimerRunning(false)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: IDLE_BEFORE_RELOAD_MS, route: '/home' })).toBe(true)
  })

  it('starts with critical false, and canReload ignores Night/idle/Kids\' Corner once critical is set', () => {
    const store = useAppUpdatesStore()
    expect(store.critical).toBe(false)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: 0, route: '/corner' })).toBe(false)

    store.critical = true
    expect(store.canReload({ nightActive: false, msSinceLastTouch: 0, route: '/corner' })).toBe(true)
  })

  it('a critical flag still can\'t reload while a screen reports a running timer', () => {
    const store = useAppUpdatesStore()
    store.critical = true
    store.setTimerRunning(true)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: 0, route: '/corner' })).toBe(false)
  })
})

describe('recoverFromChunkError', () => {
  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const data = new Map<string, string>()
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  }

  it('reloads to /home once when a route chunk fails to load', () => {
    const storage = memoryStorage()
    const reloads: string[] = []
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/SetupWizard-abc.js')

    expect(recoverFromChunkError(error, storage, (url) => reloads.push(url))).toBe(true)
    expect(recoverFromChunkError(error, storage, (url) => reloads.push(url))).toBe(false)
    expect(reloads).toEqual(['/home'])
  })

  it('recognises Safari\'s wording', () => {
    const reloads: string[] = []
    recoverFromChunkError(new TypeError('Importing a module script failed.'), memoryStorage(), (url) => reloads.push(url))
    expect(reloads).toEqual(['/home'])
  })

  it('ignores other errors', () => {
    const reloads: string[] = []
    expect(recoverFromChunkError(new Error('boom'), memoryStorage(), (url) => reloads.push(url))).toBe(false)
    expect(reloads).toEqual([])
  })
})

describe('createVersionFetcher', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches version.json bypassing every cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '1.2.3', critical: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const info = await createVersionFetcher()()

    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
    expect(info).toEqual({ version: '1.2.3', critical: false })
  })

  it('reads the critical flag when true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '1.2.4', critical: true }), { status: 200 })))
    expect(await createVersionFetcher()()).toEqual({ version: '1.2.4', critical: true })
  })

  it('treats a missing critical field as false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '1.2.5' }), { status: 200 })))
    expect(await createVersionFetcher()()).toEqual({ version: '1.2.5', critical: false })
  })

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))
    expect(await createVersionFetcher()()).toBeNull()
  })

  it('returns null when the body has no version string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ critical: true }), { status: 200 })))
    expect(await createVersionFetcher()()).toBeNull()
  })

  it('returns null instead of throwing when the fetch itself fails (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await createVersionFetcher()()).toBeNull()
  })

  it('returns null on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    expect(await createVersionFetcher()()).toBeNull()
  })
})

describe('checkForUpdate', () => {
  it('always reconnects realtime, even when nothing changed', async () => {
    const reconnectRealtime = vi.fn()
    const onNewerVersion = vi.fn()
    await checkForUpdate(async () => ({ version: '1.0.0', critical: false }), '1.0.0', onNewerVersion, reconnectRealtime)

    expect(reconnectRealtime).toHaveBeenCalledTimes(1)
    expect(onNewerVersion).not.toHaveBeenCalled()
  })

  it('reports a newer, non-critical version', async () => {
    const onNewerVersion = vi.fn()
    await checkForUpdate(async () => ({ version: '1.0.1', critical: false }), '1.0.0', onNewerVersion, vi.fn())

    expect(onNewerVersion).toHaveBeenCalledWith(false)
  })

  it('reports a newer, critical version', async () => {
    const onNewerVersion = vi.fn()
    await checkForUpdate(async () => ({ version: '1.0.1', critical: true }), '1.0.0', onNewerVersion, vi.fn())

    expect(onNewerVersion).toHaveBeenCalledWith(true)
  })

  it('does nothing when the version check fails (offline or bad response)', async () => {
    const reconnectRealtime = vi.fn()
    const onNewerVersion = vi.fn()
    await checkForUpdate(async () => null, '1.0.0', onNewerVersion, reconnectRealtime)

    expect(reconnectRealtime).toHaveBeenCalledTimes(1)
    expect(onNewerVersion).not.toHaveBeenCalled()
  })

  it('reconnects realtime even when a newer version is found', async () => {
    const reconnectRealtime = vi.fn()
    await checkForUpdate(async () => ({ version: '1.0.1', critical: true }), '1.0.0', vi.fn(), reconnectRealtime)

    expect(reconnectRealtime).toHaveBeenCalledTimes(1)
  })
})
