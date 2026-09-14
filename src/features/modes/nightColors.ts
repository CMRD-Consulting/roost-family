/**
 * Night Mode colors (spec §7.7): warm light text at low opacity over a dark radial gradient. The date's alpha is
 * the dimmest that still keeps 3:1 contrast against the gradient's lightest stop (checked in NightScreen.test.ts
 * with `src/ui/contrast.ts`). Over slideshow photos the text sits on a dark scrim instead.
 */
export const NIGHT_TEXT_RGB = [233, 223, 209] as const
export const NIGHT_CLOCK_ALPHA = 0.55
export const NIGHT_DATE_ALPHA = 0.45
/** Radial gradient stops, lightest first. */
export const NIGHT_GRADIENT_STOPS = ['#3a2a24', '#1a1412', '#0e0b0a'] as const

/** Over a slideshow photo: a scrim of the darkest night color at 60 %, and brighter text, so the clock and date keep
 *  3:1 even over a white photo (checked in NightScreen.test.ts). */
export const NIGHT_PHOTO_SCRIM_ALPHA = 0.6
export const NIGHT_PHOTO_TEXT_ALPHA = 0.85
/** The gradient's darkest stop, #0e0b0a. */
export const NIGHT_PHOTO_SCRIM_RGB = [0x0e, 0x0b, 0x0a] as const

export function nightText(alpha: number): string {
  const [r, g, b] = NIGHT_TEXT_RGB
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const NIGHT_GRADIENT = `radial-gradient(ellipse at 30% 40%, ${NIGHT_GRADIENT_STOPS[0]} 0%, ${NIGHT_GRADIENT_STOPS[1]} 55%, ${NIGHT_GRADIENT_STOPS[2]} 100%)`

export const NIGHT_PHOTO_SCRIM = `rgba(${NIGHT_PHOTO_SCRIM_RGB.join(', ')}, ${NIGHT_PHOTO_SCRIM_ALPHA})`
