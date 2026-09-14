import { describe, it, expect, vi, afterEach } from 'vitest'
import { startIdleTimer } from './idleTimer'

afterEach(() => vi.useRealTimers())

describe('startIdleTimer', () => {
  it('fires after the idle period with no touches', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    startIdleTimer(onIdle, 1000)
    vi.advanceTimersByTime(999)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('resets on pointer activity', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    startIdleTimer(onIdle, 1000)
    vi.advanceTimersByTime(800)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(800)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('stops when cancelled', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const stop = startIdleTimer(onIdle, 1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
