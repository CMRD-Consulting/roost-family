import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playChime, playClip, playNote, playPop, preloadClip, resetSoundForTests, setMuted, unlockAudio } from './sound'

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
  decoded: ArrayBuffer[] = []
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => {
    this.decoded.push(bytes)
    return { duration: 1.5, byteLength: bytes.byteLength } as unknown as AudioBuffer
  })
  sources: { buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
  createBufferSource() {
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      onended: null as (() => void) | null,
      start: vi.fn(function (this: { onended: (() => void) | null }) {
        // Finish on the next microtask, like a very short recording.
        void Promise.resolve().then(() => source.onended?.())
      }),
    }
    this.sources.push(source)
    return source
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

  it('playChime plays two tones on a running context', () => {
    unlockAudio()
    return Promise.resolve().then(() => {
      const ctx = FakeAudioContext.instances[0]!
      expect(ctx.state).toBe('running')
      playChime()
      expect(ctx.oscillators).toHaveLength(2)
      expect(ctx.oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true)
    })
  })

  it('playChime resumes a suspended context (e.g. after the tablet slept) before scheduling the tones', async () => {
    playChime()
    const ctx = FakeAudioContext.instances[0]!
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    // Nothing is scheduled against the frozen clock of a suspended context.
    expect(ctx.oscillators).toHaveLength(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.oscillators).toHaveLength(2)
  })

  it('playChime stays silent if muted while the context was resuming', async () => {
    playChime()
    setMuted(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(FakeAudioContext.instances[0]!.oscillators).toHaveLength(0)
  })

  it('playChime gives up quietly if the context cannot resume', async () => {
    class StuckAudioContext extends FakeAudioContext {
      override resume = vi.fn(async () => {
        throw new Error('not allowed')
      })
    }
    vi.stubGlobal('AudioContext', StuckAudioContext)
    expect(() => playChime()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(FakeAudioContext.instances[0]!.oscillators).toHaveLength(0)
  })

  it('playChime is silent when muted', () => {
    setMuted(true)
    playChime()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('playNote strikes two voices (the note and a quiet harmonic) at the given pitch', async () => {
    unlockAudio()
    await Promise.resolve()
    const ctx = FakeAudioContext.instances[0]!
    playNote(440)
    expect(ctx.oscillators).toHaveLength(2)
    expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual([440, 1320])
    expect(ctx.oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true)
  })

  it('playPop sweeps one tone downward', async () => {
    unlockAudio()
    await Promise.resolve()
    const ctx = FakeAudioContext.instances[0]!
    playPop()
    expect(ctx.oscillators).toHaveLength(1)
    expect(ctx.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(900, 0)
    expect(ctx.oscillators[0]!.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(300, expect.any(Number))
  })

  it('playNote and playPop resume a suspended context first and stay silent when muted', async () => {
    playNote(440)
    const ctx = FakeAudioContext.instances[0]!
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    expect(ctx.oscillators).toHaveLength(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.oscillators).toHaveLength(2)

    setMuted(true)
    playNote(440)
    playPop()
    expect(ctx.oscillators).toHaveLength(2)
  })

  describe('recordings', () => {
    const bytes = new ArrayBuffer(8)
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('missing') ? new Response(null, { status: 404 }) : new Response(bytes, { status: 200 }),
        ),
      )
    })

    it('preloadClip fetches and decodes a file once, however often it is asked', async () => {
      const a = preloadClip('/sounds/farm/cow.mp3')
      const b = preloadClip('/sounds/farm/cow.mp3')
      expect(a).toBe(b)
      await a
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(FakeAudioContext.instances[0]!.decodeAudioData).toHaveBeenCalledTimes(1)
    })

    it('playClip plays the decoded recording and resolves true when it has ended', async () => {
      unlockAudio()
      await Promise.resolve()
      await expect(playClip('/sounds/farm/cow.mp3')).resolves.toBe(true)
      const ctx = FakeAudioContext.instances[0]!
      expect(ctx.sources).toHaveLength(1)
      expect(ctx.sources[0]!.buffer).not.toBeNull()
      expect(ctx.sources[0]!.start).toHaveBeenCalledTimes(1)
    })

    it('playClip resumes a suspended context first', async () => {
      await expect(playClip('/sounds/farm/cow.mp3')).resolves.toBe(true)
      expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalledTimes(1)
    })

    it('playClip resolves false, without throwing, for a file that cannot be loaded, and tries again next time', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await expect(playClip('/sounds/farm/missing.mp3')).resolves.toBe(false)
      await expect(playClip('/sounds/farm/missing.mp3')).resolves.toBe(false)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(FakeAudioContext.instances[0]!.sources).toHaveLength(0)
      warn.mockRestore()
    })

    it('playClip is silent when muted, even if muted while the file was loading', async () => {
      setMuted(true)
      await expect(playClip('/sounds/farm/cow.mp3')).resolves.toBe(false)
      expect(fetch).not.toHaveBeenCalled()

      setMuted(false)
      const playing = playClip('/sounds/farm/pig.mp3')
      setMuted(true)
      await expect(playing).resolves.toBe(false)
      expect(FakeAudioContext.instances[0]!.sources).toHaveLength(0)
    })
  })

  it('is a no-op without WebAudio', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => {
      unlockAudio()
      playChime()
    }).not.toThrow()
  })
})
