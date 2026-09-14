/**
 * Color science helpers used to vet the person palette (src/ui/personPalette.ts):
 * sRGB <-> linear <-> XYZ (D65) <-> CIELAB, the CIEDE2000 color-difference formula,
 * and color-vision-deficiency (CVD) simulation.
 *
 * References:
 * - CIEDE2000: Sharma, Wu & Dua, "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical Observations"
 *   (2005). The reference test pairs from that paper are used in colorMath.test.ts.
 * - CVD simulation: Machado, Oliveira & Fernandes, "A Physiologically-based Model
 *   for Simulation of Color Vision Deficiency" (2009), severity-1.0 matrices,
 *   applied in linear RGB.
 */

export interface Lab {
  L: number
  a: number
  b: number
}

export type CvdType = 'protan' | 'deutan'

// ---- sRGB <-> linear RGB ----------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
}

export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

export function srgbToLinear(c8: number): number {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return v * 255
}

// ---- linear RGB -> XYZ (D65) -> CIELAB --------------------------------------

/** D65 reference white, normalized so Y = 1. */
const WHITE_D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 }

export function rgbToXyz([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const [R, G, B] = [r, g, b].map(srgbToLinear) as [number, number, number]
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  return [X, Y, Z]
}

function xyzForwardF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116
}

export function xyzToLab([X, Y, Z]: readonly [number, number, number]): Lab {
  const fx = xyzForwardF(X / WHITE_D65.X)
  const fy = xyzForwardF(Y / WHITE_D65.Y)
  const fz = xyzForwardF(Z / WHITE_D65.Z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export function hexToLab(hex: string): Lab {
  return xyzToLab(rgbToXyz(hexToRgb(hex)))
}

// ---- CIEDE2000 ---------------------------------------------------------------

const toDeg = (rad: number) => (rad * 180) / Math.PI
const toRad = (deg: number) => (deg * Math.PI) / 180

/** CIEDE2000 color difference between two Lab colors. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1
  const { L: L2, a: a2, b: b2 } = lab2

  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const avgC = (C1 + C2) / 2

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)

  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)
  const avgCp = (C1p + C2p) / 2

  const hAngle = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0
    const h = toDeg(Math.atan2(b, a))
    return h < 0 ? h + 360 : h
  }
  const h1p = C1p === 0 ? 0 : hAngle(a1p, b1)
  const h2p = C2p === 0 ? 0 : hAngle(a2p, b2)

  const deltaLp = L2 - L1
  const deltaCp = C2p - C1p

  let deltahp: number
  if (C1p * C2p === 0) deltahp = 0
  else if (Math.abs(h2p - h1p) <= 180) deltahp = h2p - h1p
  else if (h2p - h1p > 180) deltahp = h2p - h1p - 360
  else deltahp = h2p - h1p + 360
  const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(toRad(deltahp) / 2)

  const avgLp = (L1 + L2) / 2
  let avghp: number
  if (C1p * C2p === 0) avghp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) avghp = (h1p + h2p) / 2
  else if (h1p + h2p < 360) avghp = (h1p + h2p + 360) / 2
  else avghp = (h1p + h2p - 360) / 2

  const T =
    1 -
    0.17 * Math.cos(toRad(avghp - 30)) +
    0.24 * Math.cos(toRad(2 * avghp)) +
    0.32 * Math.cos(toRad(3 * avghp + 6)) -
    0.2 * Math.cos(toRad(4 * avghp - 63))

  const deltaTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2))
  const Sc = 1 + 0.045 * avgCp
  const Sh = 1 + 0.015 * avgCp * T
  const Rt = -Math.sin(toRad(2 * deltaTheta)) * Rc

  return Math.sqrt(
    Math.pow(deltaLp / Sl, 2) +
      Math.pow(deltaCp / Sc, 2) +
      Math.pow(deltaHp / Sh, 2) +
      Rt * (deltaCp / Sc) * (deltaHp / Sh),
  )
}

/** CIEDE2000 distance directly between two hex colors. */
export function hexDeltaE2000(hexA: string, hexB: string): number {
  return deltaE2000(hexToLab(hexA), hexToLab(hexB))
}

// ---- Color vision deficiency simulation --------------------------------------

/** Machado 2009 severity-1.0 matrices, applied to linear RGB. */
const CVD_MATRIX: Record<CvdType, readonly [readonly number[], readonly number[], readonly number[]]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
}

/** Simulate how a hex color appears to someone with the given CVD type. */
export function simulateCvd(hex: string, type: CvdType): string {
  const linear = hexToRgb(hex).map(srgbToLinear)
  const m = CVD_MATRIX[type]
  const simulatedLinear = m.map((row) => row[0]! * linear[0]! + row[1]! * linear[1]! + row[2]! * linear[2]!)
  const srgb = simulatedLinear.map(linearToSrgb) as [number, number, number]
  return rgbToHex(srgb)
}
