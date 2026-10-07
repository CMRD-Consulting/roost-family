/**
 * Tiny WebAudio sound effects (no asset files). Browsers keep an AudioContext suspended until a user
 * gesture, so `unlockAudio()` runs on the first pointerdown (see main.ts). Muting is for Nap and
 * Night Mode (Phase 3); the default is unmuted.
 */

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null
let muted = false

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function ensureContext(): AudioContext | null {
  if (context !== null) return context
  const Ctor = audioContextCtor()
  if (Ctor === null) return null
  try {
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

/** Create/resume the shared AudioContext. Call from a user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  const ctx = ensureContext()
  if (ctx !== null && ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

export function setMuted(value: boolean): void {
  muted = value
}

export function isMuted(): boolean {
  return muted
}

/**
 * Runs `play` against the shared context: at once when it runs, or once it has resumed when the browser
 * suspended it (e.g. while the tablet slept). Scheduled against a suspended context's frozen clock the sound
 * would never be heard. No-op when muted or unsupported; stays quiet if resuming isn't allowed.
 */
function withContext(play: (ctx: AudioContext) => void): void {
  if (muted) return
  const ctx = ensureContext()
  if (ctx === null) return
  if (ctx.state !== 'suspended') {
    play(ctx)
    return
  }
  ctx
    .resume()
    .then(() => {
      if (!muted) play(ctx)
    })
    .catch(() => {
      // Not allowed to resume without a user gesture: stay silent rather than throw.
    })
}

/** A soft two-tone chime (E5 then A5) for the sticker celebration and the visual timer. */
export function playChime(): void {
  withContext(scheduleChime)
}

/** One xylophone-like note at `frequency` Hz (Kids' Corner Music game): a bright strike that rings for a moment. */
export function playNote(frequency: number): void {
  withContext((ctx) => scheduleNote(ctx, frequency))
}

/** A short "plink" for a popped bubble (Kids' Corner Bubbles game): a quick downward sweep. */
export function playPop(): void {
  withContext(schedulePop)
}

function scheduleChime(ctx: AudioContext): void {
  const start = ctx.currentTime
  const notes: [frequency: number, offset: number][] = [
    [659.25, 0],
    [880, 0.14],
  ]
  for (const [frequency, offset] of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    const t = start + offset
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.5)
  }
}

function scheduleNote(ctx: AudioContext, frequency: number): void {
  const t = ctx.currentTime
  // Fundamental plus a quieter third harmonic: a wooden-bar timbre rather than a pure beep.
  const voices: [multiple: number, peak: number, decay: number][] = [
    [1, 0.3, 0.9],
    [3, 0.06, 0.25],
  ]
  for (const [multiple, peak, decay] of voices) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency * multiple
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + decay + 0.05)
  }
}

function schedulePop(ctx: AudioContext): void {
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(900, t)
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.09)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.15)
}

/** Decoded recordings by URL, so a clip is fetched and decoded once per session. */
const clips = new Map<string, Promise<AudioBuffer | null>>()

/**
 * Fetches and decodes a recording (e.g. the Farm game's animal sounds) so a later `playClip` starts at once.
 * Resolves to null when the file can't be loaded or there is no WebAudio. Safe to call repeatedly.
 */
export function preloadClip(url: string): Promise<AudioBuffer | null> {
  const existing = clips.get(url)
  if (existing) return existing
  const ctx = ensureContext()
  if (ctx === null) return Promise.resolve(null)
  const loading = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.arrayBuffer()
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .catch((e: unknown) => {
      console.warn(`Couldn't load sound ${url}`, e)
      clips.delete(url) // so a flaky network gets another try next time
      return null
    })
  clips.set(url, loading)
  return loading
}

/**
 * Plays a recording. Resolves when it has finished (so a voice can follow it), or with `false` when it didn't
 * play: muted, no WebAudio, the file couldn't be loaded, or a suspended context that may not resume.
 */
export async function playClip(url: string): Promise<boolean> {
  if (muted) return false
  const ctx = ensureContext()
  if (ctx === null) return false
  const buffer = await preloadClip(url)
  if (buffer === null || muted) return false
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return false
    }
    if (muted) return false
  }
  return new Promise<boolean>((resolve) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => resolve(true)
    source.start()
  })
}

/** Test-only: forget the shared context and mute state. */
export function resetSoundForTests(): void {
  context = null
  muted = false
  clips.clear()
}
