/**
 * WCAG 2.x relative luminance and contrast ratio.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
}

function srgbChannelToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Relative luminance of a sRGB hex color, in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbChannelToLinear)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two sRGB hex colors, in [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}
