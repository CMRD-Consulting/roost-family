import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSoundForTests, setMuted } from '@/ui/sound'
import { speak } from './speech'

class FakeUtterance {
  rate = 1
  constructor(public text: string) {}
}

let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }

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
})
