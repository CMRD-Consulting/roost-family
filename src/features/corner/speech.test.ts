import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSoundForTests, setMuted } from '@/ui/sound'
import { pickVoice, speak } from './speech'

class FakeUtterance {
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  constructor(public text: string) {}
}

function voice(name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return { name, lang, localService: false, default: false, voiceURI: name, ...extra }
}

let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices?: () => SpeechSynthesisVoice[] }

describe('speak', () => {
  beforeEach(() => {
    resetSoundForTests()
    synth = { speak: vi.fn(), cancel: vi.fn() }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSoundForTests()
  })

  it('cancels whatever is being said, then says the text at a friendly rate', () => {
    speak('Brush teeth')
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(synth.speak).toHaveBeenCalledTimes(1)
    const utterance = synth.speak.mock.calls[0]![0] as FakeUtterance
    expect(utterance.text).toBe('Brush teeth')
    expect(utterance.rate).toBe(0.9)
    expect(synth.cancel.mock.invocationCallOrder[0]).toBeLessThan(synth.speak.mock.invocationCallOrder[0]!)
  })

  it('stays silent while sounds are muted (Nap and Night Mode)', () => {
    setMuted(true)
    speak('Bath')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('does nothing where speech synthesis is unavailable', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(() => speak('Bed')).not.toThrow()
  })

  it('swallows errors from the speech engine', () => {
    synth.speak.mockImplementation(() => {
      throw new Error('not allowed')
    })
    expect(() => speak('Park')).not.toThrow()
  })

  it('prefers an enhanced voice in the tablet language over the compact default', () => {
    const voices = [
      voice('Fred', 'en-US', { default: true, localService: true }),
      voice('Samantha', 'en-US', { localService: true }),
      voice('Samantha (Enhanced)', 'en-US', { localService: true }),
      voice('Amélie', 'fr-CA', { localService: true }),
    ]
    expect(pickVoice(voices, 'en-US')?.name).toBe('Samantha (Enhanced)')
    expect(pickVoice(voices, 'fr-CA')?.name).toBe('Amélie')
    // Same language, other region: still better than switching language.
    expect(pickVoice(voices, 'en-GB')?.name).toBe('Samantha (Enhanced)')
    // Nothing in the language at all: the best of what there is.
    expect(pickVoice([voice('Fred', 'en-US', { default: true })], 'de-DE')?.name).toBe('Fred')
    expect(pickVoice([], 'en-US')).toBeNull()
  })

  it('sets the chosen voice on the utterance when the browser lists voices', () => {
    const best = voice('Samantha (Enhanced)', 'en-US')
    synth.getVoices = vi.fn(() => [voice('Fred', 'en-US', { default: true }), best])
    vi.stubGlobal('speechSynthesis', synth)
    speak('Cow')
    const utterance = synth.speak.mock.calls[0]![0] as FakeUtterance
    expect(utterance.voice).toBe(best)
  })
})
