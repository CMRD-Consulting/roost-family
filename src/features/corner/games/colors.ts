/**
 * The Colors game's palette (Kids' Corner, spec §7.5): six bold, well-separated colours a toddler names first.
 * Decoration only, so they needn't follow the person palette. Each has a recording of its name under
 * public/sounds/colors (see public/sounds/farm/SOURCES.md).
 */
export interface GameColor {
  key: string
  name: string
  hex: string
}

export const GAME_COLORS: readonly GameColor[] = [
  { key: 'red', name: 'Red', hex: '#e03b3b' },
  { key: 'blue', name: 'Blue', hex: '#2f6fd6' },
  { key: 'yellow', name: 'Yellow', hex: '#f2c53d' },
  { key: 'green', name: 'Green', hex: '#3faa5f' },
  { key: 'orange', name: 'Orange', hex: '#f08a2e' },
  { key: 'purple', name: 'Purple', hex: '#8c4fc9' },
]

export function colorNameClipUrl(color: GameColor): string {
  return `/sounds/colors/${color.key}.mp3`
}
