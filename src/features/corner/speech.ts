import { isMuted } from '@/ui/sound'

const FRIENDLY_RATE = 0.9

/**
 * Says `text` aloud with the browser's speech synthesis (Kids' Corner step labels, spec §7.5). Anything still
 * being said is cancelled first, so repeated taps don't queue up. Silent while sounds are muted (Nap and
 * Night Mode) and a no-op where speech isn't available.
 */
export function speak(text: string): void {
  if (isMuted()) return
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance
  if (!synth || !Utterance) return
  try {
    synth.cancel()
    const utterance = new Utterance(text)
    utterance.rate = FRIENDLY_RATE
    synth.speak(utterance)
  } catch (e) {
    console.warn('Speech synthesis failed', e)
  }
}
