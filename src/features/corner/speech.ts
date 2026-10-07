import { isMuted } from '@/ui/sound'

const FRIENDLY_RATE = 0.9

/**
 * Picks the most natural voice for the tablet's language. Browsers list many voices; the compact, robotic
 * ones are the default too often. Preference: a voice marked enhanced/premium/natural, then any voice that
 * isn't a known compact one, then the browser's default. Voices load asynchronously in some browsers, so
 * this is re-evaluated on every call (it's cheap) and returns null until the list is populated.
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], language = navigator.language): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null
  const lang = language.toLowerCase()
  const base = lang.split('-')[0]!
  const sameLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  const pool = sameLanguage.length > 0 ? sameLanguage : voices
  const exact = pool.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang)
  const ranked = [...(exact.length > 0 ? exact : pool)].sort((a, b) => quality(b) - quality(a))
  return ranked[0] ?? null
}

/** Higher is better. Names are the only quality signal the Web Speech API gives. */
function quality(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  let score = 0
  if (/enhanced|premium|natural|neural|siri/.test(name)) score += 4
  if (/samantha|karen|daniel|moira|tessa|google/.test(name)) score += 2
  if (/compact|eloquence|fred|zarvox|trinoids|whisper|bells|cellos|bad news|bubbles|boing|albert|junior|kathy|ralph/.test(name)) score -= 4
  if (voice.localService) score += 1
  if (voice.default) score += 0.5
  return score
}

/**
 * Says `text` aloud with the browser's speech synthesis (Kids' Corner step labels and animal names, spec §7.5).
 * Anything still being said is cancelled first, so repeated taps don't queue up. Silent while sounds are muted
 * (Nap and Night Mode) and a no-op where speech isn't available.
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
    const voice = pickVoice(synth.getVoices?.() ?? [])
    if (voice) utterance.voice = voice
    synth.speak(utterance)
  } catch (e) {
    console.warn('Speech synthesis failed', e)
  }
}
