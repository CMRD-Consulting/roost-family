import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RLongPress from './RLongPress.vue'

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

describe('RLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    let id = 0
    const frames = new Map<number, ReturnType<typeof setTimeout>>()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const handle = ++id
      frames.set(handle, setTimeout(() => cb(Date.now()), 16))
      return handle
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(frames.get(handle)))
    setReducedMotion(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** jsdom has no PointerEvent: build a MouseEvent and add the pointer fields. */
  async function fire(w: ReturnType<typeof mount>, type: string, init: Partial<PointerEventInit> = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY, button: init.button })
    Object.defineProperties(event, {
      pointerId: { value: init.pointerId ?? 1 },
      pointerType: { value: init.pointerType ?? 'touch' },
    })
    w.element.dispatchEvent(event)
    await w.vm.$nextTick()
  }

  const mountPress = () => mount(RLongPress, { slots: { default: '<span class="r-longpress-ring"></span>Sleep' } })
  const down = { pointerId: 1, clientX: 10, clientY: 10, button: 0, pointerType: 'touch' }

  it('emits complete after holding for the default 600 ms', async () => {
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    vi.advanceTimersByTime(599)
    expect(w.emitted('complete')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(w.emitted('complete')).toHaveLength(1)
  })

  it('writes progress to --rlp-progress on animation frames while pressed', async () => {
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    expect(w.attributes('data-pressing')).toBeDefined()
    vi.advanceTimersByTime(300)
    const p = Number((w.element as HTMLElement).style.getPropertyValue('--rlp-progress'))
    expect(p).toBeGreaterThan(0.4)
    expect(p).toBeLessThan(0.6)
    vi.advanceTimersByTime(300)
    expect((w.element as HTMLElement).style.getPropertyValue('--rlp-progress')).toBe('0')
  })

  it('honours a custom duration', async () => {
    const w = mount(RLongPress, { props: { duration: 2000 } })
    await fire(w, 'pointerdown', down)
    vi.advanceTimersByTime(1999)
    expect(w.emitted('complete')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(w.emitted('complete')).toHaveLength(1)
  })

  it.each(['pointerup', 'pointercancel', 'pointerleave'] as const)('cancels on %s', async (event) => {
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    vi.advanceTimersByTime(400)
    await fire(w, event, { pointerId: 1 })
    vi.advanceTimersByTime(1000)
    expect(w.emitted('complete')).toBeUndefined()
    expect(w.attributes('data-pressing')).toBeUndefined()
  })

  it('tolerates small movement but cancels past 12 px', async () => {
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    await fire(w, 'pointermove', { pointerId: 1, clientX: 18, clientY: 14 })
    vi.advanceTimersByTime(600)
    expect(w.emitted('complete')).toHaveLength(1)

    await fire(w, 'pointerdown', down)
    await fire(w, 'pointermove', { pointerId: 1, clientX: 10, clientY: 23 })
    vi.advanceTimersByTime(1000)
    expect(w.emitted('complete')).toHaveLength(1)
  })

  it('fires once per press even if the pointer stays down', async () => {
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    vi.advanceTimersByTime(3000)
    expect(w.emitted('complete')).toHaveLength(1)
  })

  it('shows a static bar and runs no animation frames with reduced motion', async () => {
    setReducedMotion(true)
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const w = mountPress()
    await fire(w, 'pointerdown', down)
    expect(w.find('[data-testid="longpress-bar"]').exists()).toBe(true)
    vi.advanceTimersByTime(600)
    expect(raf).not.toHaveBeenCalled()
    expect(w.emitted('complete')).toHaveLength(1)
    await w.vm.$nextTick()
    expect(w.find('[data-testid="longpress-bar"]').exists()).toBe(false)
  })

  it('supports holding Enter or Space from the keyboard', async () => {
    const w = mountPress()
    await w.trigger('keydown', { key: ' ' })
    vi.advanceTimersByTime(200)
    await w.trigger('keyup', { key: ' ' })
    vi.advanceTimersByTime(600)
    expect(w.emitted('complete')).toBeUndefined()
    await w.trigger('keydown', { key: 'Enter' })
    vi.advanceTimersByTime(600)
    expect(w.emitted('complete')).toHaveLength(1)
  })
})
