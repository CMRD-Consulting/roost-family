/** Colors reserved for log buttons; person colors must never reuse these. */
export const LOG_BUTTON_COLORS = {
  medicine: '#E2703A',
  sticker: '#D9A441',
  feeding: '#5FA88C',
} as const

/**
 * Ten person colors, chosen (see src/ui/colorMath.ts) so that:
 * - white text/initials meet >= 4.5:1 contrast on every color (small text safe, not
 *   just large text);
 * - every color is CIEDE2000 >= 15 from each log-button color above;
 * - every pair is CIEDE2000 >= 12 apart under normal vision;
 * - every pair stays CIEDE2000 >= 6 apart under simulated protanopia and
 *   deuteranopia (Machado 2009 severity-1.0 matrices).
 * See personPalette.test.ts for the checks. Colors repeat past 10 people; the
 * avatar initial always disambiguates.
 */
export const PERSON_COLORS = [
  '#653437', // brick
  '#2C7F8C', // teal
  '#887425', // ochre
  '#2A2A98', // indigo
  '#3B724A', // forest
  '#68451D', // umber
  '#275F90', // denim
  '#601A57', // plum
  '#275454', // pine
  '#982A5D', // berry
] as const

export function personColor(index: number): string {
  return PERSON_COLORS[((index % PERSON_COLORS.length) + PERSON_COLORS.length) % PERSON_COLORS.length]!
}
