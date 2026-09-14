/**
 * Hex values for the color tokens whose contrast is asserted in contrast.test.ts.
 *
 * These MUST stay in sync with the `--color-*` custom properties in
 * `src/styles/app.css` by hand — app.css is the source of truth for what actually
 * renders; this file exists only so the contrast math can be unit tested without
 * parsing CSS. If you change a value here, change it in app.css too (and vice versa).
 */
export const TOKENS = {
  surface: '#FBF6EE',
  app: '#F5EEE3',
  orangeDeep: '#A84B24',
  greenDeep: '#2F6B57',
  amberDeep: '#8A5E0F',
  warnInk: '#7A3418',
} as const
