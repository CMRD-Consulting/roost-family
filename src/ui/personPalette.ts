/** Colors reserved for log buttons; person colors must never reuse these. */
export const LOG_BUTTON_COLORS = {
  medicine: '#E2703A',
  sticker: '#D9A441',
  feeding: '#5FA88C',
} as const

/**
 * Ten person colors. White initials on these meet 3:1 at >= 24pt bold (large text).
 * Colors repeat past 10 people; the avatar initial always disambiguates.
 */
export const PERSON_COLORS = [
  '#5B6ACF', // indigo
  '#C2477A', // raspberry
  '#2F86A6', // ocean
  '#8A56AC', // plum
  '#5C6B7C', // slate
  '#7A5236', // cocoa
  '#2F7FB8', // sky
  '#7F68C4', // lilac
  '#C45A7C', // rose
  '#34507A', // navy
] as const

export function personColor(index: number): string {
  return PERSON_COLORS[((index % PERSON_COLORS.length) + PERSON_COLORS.length) % PERSON_COLORS.length]!
}
