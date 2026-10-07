import type { InjectionKey } from 'vue'
import type { Rng } from './bubbles'

/** Random source for the games; tests provide a seeded one for predictable rounds. */
export const GAME_RNG: InjectionKey<Rng> = Symbol('game-rng')
