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

/** A soft two-tone chime (E5 then A5) for the sticker celebration. No-op when muted or unsupported. */
export function playChime(): void {
  if (muted) return
  const ctx = ensureContext()
  if (ctx === null) return
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

/** Test-only: forget the shared context and mute state. */
export function resetSoundForTests(): void {
  context = null
  muted = false
}
