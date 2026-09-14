import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IDLE_BEFORE_RELOAD_MS, isSafeReloadMoment, recoverFromChunkError, useAppUpdatesStore } from './appUpdates'

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
