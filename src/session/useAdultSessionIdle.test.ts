import { describe, it, expect, vi, afterEach } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { useAdultSessionIdle } from './useAdultSessionIdle'
import type { AdultSession } from './adultSession'
import { clearReloadHolds, hasReloadHold } from '@/app/reloadHolds'

afterEach(() => {
  vi.useRealTimers()
  clearReloadHolds()
})

function session(id: string, end = vi.fn(async () => {})): AdultSession & { end: typeof end } {
  return { client: {} as never, userId: id, email: `${id}@roost.test`, end }
}

function setup(initial: AdultSession | null = null) {
  vi.useFakeTimers()
  const current = shallowRef<AdultSession | null>(initial)
  const busy = ref(false)
  const order: string[] = []
  const onExpired = vi.fn(() => {
    order.push('expired')
    current.value = null
  })
  const scope = effectScope()
  scope.run(() => useAdultSessionIdle({ session: () => current.value, busy: () => busy.value, onExpired, idleMs: 1000 }))
  return { current, busy, onExpired, order, scope }
}

describe('useAdultSessionIdle', () => {
  it('expires an idle session: onExpired first, then end', () => {
    const s = session('a', vi.fn(async () => {}))
    const t = setup()
    s.end.mockImplementation(async () => void t.order.push('end'))
    t.current.value = s

    vi.advanceTimersByTime(999)
    expect(t.onExpired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.order).toEqual(['expired', 'end'])
    expect(s.end).toHaveBeenCalledOnce()
  })

  it('starts the timer for a session present at start and resets on activity', () => {
    const s = session('a')
    const t = setup(s)
    vi.advanceTimersByTime(800)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(800)
    expect(s.end).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(s.end).toHaveBeenCalledOnce()
    t.scope.stop()
  })

  it('does not fire while busy and re-arms when busy clears', () => {
    const s = session('a')
    const t = setup(s)
    t.busy.value = true
    vi.advanceTimersByTime(5000)
    expect(t.onExpired).not.toHaveBeenCalled()

    t.busy.value = false
    vi.advanceTimersByTime(999)
    expect(t.onExpired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.onExpired).toHaveBeenCalledOnce()
    expect(s.end).toHaveBeenCalledOnce()
  })

  it('ends the previous session when replaced by a different one', () => {
    const a = session('a')
    const b = session('b')
    const t = setup(a)
    t.current.value = b
    expect(a.end).toHaveBeenCalledOnce()
    expect(b.end).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(b.end).toHaveBeenCalledOnce()
  })

  it('stops the timer without ending when the session is cleared by its owner', () => {
    const s = session('a')
    const t = setup(s)
    t.current.value = null
    vi.advanceTimersByTime(5000)
    expect(s.end).not.toHaveBeenCalled()
    expect(t.onExpired).not.toHaveBeenCalled()
  })

  it('ends the active session on scope dispose and swallows end failures', async () => {
    const s = session('a', vi.fn(async () => Promise.reject(new Error('offline'))))
    const t = setup(s)
    t.scope.stop()
    expect(s.end).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(5000)
    expect(t.onExpired).not.toHaveBeenCalled()
    await Promise.resolve()
  })

  it('holds app-update reloads while a session is signed in (spec §5.8)', () => {
    const t = setup()
    expect(hasReloadHold('signIn')).toBe(false)
    t.current.value = session('a')
    expect(hasReloadHold('signIn')).toBe(true)
    t.current.value = null
    expect(hasReloadHold('signIn')).toBe(false)
    t.current.value = session('b')
    t.scope.stop()
    expect(hasReloadHold('signIn')).toBe(false)
  })
})
