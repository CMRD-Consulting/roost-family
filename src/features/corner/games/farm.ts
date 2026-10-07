/**
 * The Farm game's animals (Kids' Corner, spec §7.5). Each has a short recording under public/sounds/farm
 * (sources and licences in public/sounds/farm/SOURCES.md), followed by a recording of its name.
 */
export interface FarmAnimal {
  key: string
  /** Spoken after the sound, and the tile's label. */
  name: string
  /** The picture: an emoji, drawn large. The tablet's own emoji font is the illustration library here. */
  emoji: string
  /** Soft tile tint behind the picture; decoration only. */
  tint: string
}

export const FARM_ANIMALS: readonly FarmAnimal[] = [
  { key: 'cow', name: 'Cow', emoji: '🐄', tint: '#e7eef8' },
  { key: 'pig', name: 'Pig', emoji: '🐷', tint: '#fbe3e8' },
  { key: 'sheep', name: 'Sheep', emoji: '🐑', tint: '#f1f1ec' },
  { key: 'goat', name: 'Goat', emoji: '🐐', tint: '#e3f1ec' },
  { key: 'horse', name: 'Horse', emoji: '🐴', tint: '#f3e6d6' },
  { key: 'rooster', name: 'Rooster', emoji: '🐓', tint: '#fbeedc' },
  { key: 'dog', name: 'Dog', emoji: '🐶', tint: '#ece7f6' },
  { key: 'cat', name: 'Cat', emoji: '🐱', tint: '#fdf0d8' },
]

/** The animal's call, served from the app's own origin (precached by the service worker). */
export function animalClipUrl(animal: FarmAnimal): string {
  return `/sounds/farm/${animal.key}.mp3`
}

/**
 * A recording of the animal's name. Shipped as a file rather than left to the tablet's speech synthesis, whose
 * compact voices sound robotic; speech synthesis is only the fallback when the file is missing.
 */
export function animalNameClipUrl(animal: FarmAnimal): string {
  return `/sounds/farm/names/${animal.key}.mp3`
}
