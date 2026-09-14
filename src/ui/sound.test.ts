import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playChime, resetSoundForTests, setMuted, unlockAudio } from './sound'

class FakeParam {
  value = 0
  setValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: 'suspended' | 'running' = 'suspended'
  currentTime = 0
  destination = {}
  oscillators: { frequency: FakeParam; start: ReturnType<typeof vi.fn> }[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  createOscillator() {
    const osc = { type: '', frequency: new FakeParam(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    this.oscillators.push(osc)
    return osc
  }
  createGain() {
    return { gain: new FakeParam(), connect: vi.fn() }
  }
}

describe('sound', () => {
  beforeEach(() => {
    resetSoundForTests()
    FakeAudioContext.instances = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('unlockAudio creates and resumes one shared context', () => {
    unlockAudio()
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalled()
  })

  it('playChime plays two tones', () => {
    playChime()
    const ctx = FakeAudioContext.instances[0]!
    expect(ctx.oscillators).toHaveLength(2)
    expect(ctx.oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true)
  })

  it('playChime is silent when muted', () => {
    setMuted(true)
    playChime()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('is a no-op without WebAudio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => {
      unlockAudio()
      playChime()
    }).not.toThrow()
  })
})
