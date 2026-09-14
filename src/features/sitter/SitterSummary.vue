<script setup lang="ts">
/** "While You Were Out" (spec §7.6): full screen, shown when Sitter Mode ends, closed with Done. */
import { nextTick, onMounted, useTemplateRef } from 'vue'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import type { SummaryIcon, SummaryLine, SummaryModel } from './sitterModel'

defineProps<{ model: SummaryModel }>()
const emit = defineEmits<{ close: [] }>()

const root = useTemplateRef<HTMLElement>('root')
onMounted(async () => {
  await nextTick()
  root.value?.focus()
})

/** Same shapes as the log row's icons. */
const ICON: Record<SummaryIcon, string> = {
  sleep: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  feeding: 'M9 3h6 M10 3v3l-2 3v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9l-2-3V3 M8 13h8',
  medicine: 'M12 5v14 M5 12h14',
  sticker: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z',
  diaper: 'M12 3c3 4.5 6 8 6 11.5a6 6 0 0 1-12 0C6 11 9 7.5 12 3z',
}

const isVoided = (line: SummaryLine) => line.flags?.some((f) => f.kind === 'voided') ?? false
</script>

<template>
  <div
    ref="root"
    role="dialog"
    aria-modal="true"
    aria-labelledby="sitter-summary-title"
    tabindex="-1"
    data-testid="sitter-summary"
    class="fixed inset-0 z-50 overflow-y-auto bg-app text-ink outline-none"
  >
    <div class="mx-auto flex min-h-full max-w-[1100px] flex-col gap-8 px-10 py-10">
      <header class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h1 id="sitter-summary-title" class="text-[44px] font-semibold leading-tight">{{ model.title }}</h1>
        <p data-testid="summary-sitter" class="text-[22px] text-ink-2">{{ model.sitterName }} · {{ model.rangeLabel }}</p>
      </header>

      <div class="grid gap-6 min-[900px]:grid-cols-2">
        <section
          v-for="child in model.children"
          :key="child.childId"
          data-testid="summary-child"
          class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-[26px] py-[22px]"
        >
          <div class="flex items-center gap-3">
            <RAvatar :name="child.name" :color="child.color" :size="44" decorative />
            <h2 class="text-[28px] font-semibold">{{ child.name }}</h2>
          </div>
          <ul v-if="child.lines.length > 0" class="flex flex-col gap-3">
            <li v-for="(line, i) in child.lines" :key="i" data-testid="summary-line" class="flex gap-4">
              <span data-testid="summary-time" class="w-[88px] shrink-0 pt-[3px] text-[18px] tabular-nums text-ink-3">{{ line.time }}</span>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="mt-[3px] shrink-0 text-ink-2"
                aria-hidden="true"
              >
                <path :d="ICON[line.icon]" />
              </svg>
              <div class="flex min-w-0 flex-col gap-1">
                <span data-testid="summary-text" class="text-[22px] leading-snug" :class="isVoided(line) && 'line-through'">
                  {{ line.text }}
                </span>
                <span
                  v-for="flag in line.flags ?? []"
                  :key="flag.kind"
                  data-testid="summary-flag"
                  class="flex items-center gap-2 text-[18px] font-semibold text-warn-ink"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M12 3l10 18H2z" />
                    <path d="M12 10v4M12 17.5v.5" />
                  </svg>
                  {{ flag.text }}
                </span>
              </div>
            </li>
          </ul>
          <p v-else class="text-[22px] text-ink-3">Nothing logged</p>
        </section>
      </div>

      <div class="mt-auto flex justify-end">
        <RButton tier="moment" class="min-w-[240px]" @click="emit('close')">Done</RButton>
      </div>
    </div>
  </div>
</template>
