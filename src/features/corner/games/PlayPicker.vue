<script setup lang="ts">
/** The Play tab's menu (Kids' Corner games, spec §7.5): one big picture tile per game. */
export type GameId = 'farm' | 'bubbles' | 'music'

const emit = defineEmits<{ pick: [game: GameId] }>()

const GAMES: { id: GameId; label: string; emoji: string; tint: string }[] = [
  { id: 'farm', label: 'Farm', emoji: '🐄', tint: '#e3f1ec' },
  { id: 'bubbles', label: 'Bubbles', emoji: '🫧', tint: '#e7eef8' },
  { id: 'music', label: 'Music', emoji: '🎵', tint: '#fbeedc' },
]
</script>

<template>
  <section data-testid="play-picker" class="flex h-full flex-col items-center justify-center gap-10 px-10">
    <ul class="flex flex-wrap justify-center gap-8">
      <li v-for="game in GAMES" :key="game.id">
        <button
          type="button"
          data-testid="play-game"
          :aria-label="game.label"
          class="flex size-[220px] flex-col items-center justify-center gap-2 rounded-[32px] text-ink-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          :style="{ background: game.tint, boxShadow: '0 20px 50px rgba(90, 70, 54, 0.18)' }"
          @click="emit('pick', game.id)"
        >
          <span class="text-[110px] leading-none" aria-hidden="true">{{ game.emoji }}</span>
          <span class="text-[28px] font-semibold leading-tight">{{ game.label }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
