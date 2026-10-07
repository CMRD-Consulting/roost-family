/**
 * The Music game's bars (Kids' Corner, spec §7.5): a C major pentatonic scale across an octave and a half, so
 * any order of taps sounds like a tune. Colours are decoration only (rainbow order, longest bar first).
 */
export interface XylophoneBar {
  note: string
  frequency: number
  color: string
}

export const XYLOPHONE_BARS: readonly XylophoneBar[] = [
  { note: 'C5', frequency: 523.25, color: '#e2703a' },
  { note: 'D5', frequency: 587.33, color: '#e9a23b' },
  { note: 'E5', frequency: 659.25, color: '#d9c04a' },
  { note: 'G5', frequency: 783.99, color: '#7fb77e' },
  { note: 'A5', frequency: 880.0, color: '#5fa8a0' },
  { note: 'C6', frequency: 1046.5, color: '#5e8fc9' },
  { note: 'D6', frequency: 1174.66, color: '#8477c6' },
  { note: 'E6', frequency: 1318.51, color: '#c279b4' },
]
