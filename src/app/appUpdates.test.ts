import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { clearReloadHolds, holdReload } from './reloadHolds'
import {
  CRITICAL_IDLE_MS,
  IDLE_BEFORE_RELOAD_MS,
  isDialogOpen,
  isPublicPath,
  startAppUpdates,
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

  it('a critical update needs only a minute without a touch, even in Kids\' Corner (not 5 minutes, not Night Mode)', () => {
    const critical = { ...idle, critical: true }
    expect(isSafeReloadMoment({ ...critical, msSinceLastTouch: CRITICAL_IDLE_MS })).toBe(true)
    expect(isSafeReloadMoment({ ...critical, msSinceLastTouch: CRITICAL_IDLE_MS, route: '/corner' })).toBe(true)
    expect(isSafeReloadMoment({ ...idle, msSinceLastTouch: CRITICAL_IDLE_MS })).toBe(false)
  })

  it('a critical update never reloads during input: within a minute of a touch or key press', () => {
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: 0 })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: CRITICAL_IDLE_MS - 1 })).toBe(false)
  })

  it('a critical update waits for an open sheet or dialog, a Settings PIN session and an adult sign-in', () => {
    const critical = { ...idle, critical: true, msSinceLastTouch: CRITICAL_IDLE_MS }
    expect(isSafeReloadMoment({ ...critical, dialogOpen: true })).toBe(false)
    expect(isSafeReloadMoment({ ...critical, settingsSessionOpen: true })).toBe(false)
    expect(isSafeReloadMoment({ ...critical, adultSignInActive: true })).toBe(false)
  })

  it('a critical update is never less eager than the normal rules', () => {
    expect(isSafeReloadMoment({ ...idle, critical: true, dialogOpen: true })).toBe(true)
    expect(isSafeReloadMoment({ ...idle, critical: true, nightActive: true, msSinceLastTouch: 0 })).toBe(true)
  })

  it('never reloads while a photo upload is in flight, critical, in Night Mode or idle', () => {
    expect(isSafeReloadMoment({ ...idle, photoUploading: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, nightActive: true, photoUploading: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: 60 * 60_000, photoUploading: true })).toBe(false)
  })

  it('never reloads a public page (Manage household, the Take list) on its own, even in Night Mode or when critical', () => {
    expect(isSafeReloadMoment({ ...idle, route: '/manage', publicRoute: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, route: '/manage', publicRoute: true, nightActive: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, route: '/list/abc', publicRoute: true, critical: true, msSinceLastTouch: 0 })).toBe(false)
  })

  it('never lets a critical update interrupt a running visual timer', () => {
    expect(isSafeReloadMoment({ ...idle, critical: true, timerRunning: true })).toBe(false)
    expect(isSafeReloadMoment({ ...idle, critical: true, msSinceLastTouch: 60 * 60_000, timerRunning: true })).toBe(false)
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

  afterEach(() => clearReloadHolds())

  it('starts with critical false; once critical, canReload needs only a minute idle, even in Kids\' Corner', () => {
    const store = useAppUpdatesStore()
    expect(store.critical).toBe(false)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: CRITICAL_IDLE_MS, route: '/corner' })).toBe(false)

    store.critical = true
    expect(store.canReload({ nightActive: false, msSinceLastTouch: 0, route: '/corner' })).toBe(false)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: CRITICAL_IDLE_MS, route: '/corner' })).toBe(true)
  })

  it('a critical flag still can\'t reload while a screen reports a running timer', () => {
    const store = useAppUpdatesStore()
    store.critical = true
    store.setTimerRunning(true)
    expect(store.canReload({ nightActive: false, msSinceLastTouch: CRITICAL_IDLE_MS, route: '/corner' })).toBe(false)
  })

  it('canReload reads sign-in and photo-upload holds', () => {
    const store = useAppUpdatesStore()
    store.critical = true
    const input = { nightActive: false, msSinceLastTouch: CRITICAL_IDLE_MS, route: '/settings/photos' }
    holdReload('sign-in', 'signIn')
    expect(store.canReload(input)).toBe(false)
    clearReloadHolds()
    holdReload('upload', 'photoUpload')
    expect(store.canReload({ ...input, nightActive: true })).toBe(false)
    clearReloadHolds()
    expect(store.canReload(input)).toBe(true)
  })
})

describe('isDialogOpen', () => {
  afterEach(() => (document.body.innerHTML = ''))

  it('is true while a modal sheet, dialog or open <dialog> is in the page', () => {
    expect(isDialogOpen(document)).toBe(false)
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(isDialogOpen(document)).toBe(true)
    document.body.innerHTML = '<dialog open></dialog>'
    expect(isDialogOpen(document)).toBe(true)
    document.body.innerHTML = '<dialog></dialog>'
    expect(isDialogOpen(document)).toBe(false)
  })
})

describe('service worker on public routes', () => {
  const routes: Record<string, boolean> = {
    '/home': false,
    '/settings/photos': false,
    '/list/q3Z9_xYv-4LmN0pQrStUvWxYz12345678AbCdEfGhIj': true,
    '/manage': true,
    '/manage/export/6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b': true,
  }
  const fakeRouter = {
    resolve: (path: string) => ({ meta: { public: routes[path] === true } }),
  }

  afterEach(() => vi.unstubAllGlobals())

  it('isPublicPath resolves the path against the router\'s public meta', async () => {
    const { router } = await import('@/router')
    for (const [path, isPublic] of Object.entries(routes)) expect(isPublicPath(router, path), path).toBe(isPublic)
  })

  it('startAppUpdates registers no service worker on the Take list or Manage household', async () => {
    const register = vi.fn()
    vi.stubGlobal('navigator', { serviceWorker: { register }, onLine: true })
    for (const path of ['/list/q3Z9_xYv-4LmN0pQrStUvWxYz12345678AbCdEfGhIj', '/manage', '/manage/export/6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b']) {
      setActivePinia(createPinia())
      await expect(startAppUpdates(fakeRouter as never, path)).resolves.toBe(false)
    }
    expect(register).not.toHaveBeenCalled()
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
