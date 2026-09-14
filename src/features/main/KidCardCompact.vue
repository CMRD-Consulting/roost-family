<script setup lang="ts">
import { computed } from 'vue'
import RAvatar from '@/ui/RAvatar.vue'
import type { KidCardModel } from './mainScreenModel'

const props = defineProps<{ card: KidCardModel }>()

const status = computed(() => props.card.sleep?.label ?? props.card.nowNext?.now?.label ?? props.card.ageLabel)
</script>

<template>
  <article
    data-testid="kid-card-compact"
    class="flex min-w-0 items-center gap-3 rounded-[18px] border-l-8 bg-surface px-4 py-1.5"
    :style="{ borderLeftColor: card.color }"
  >
    <RAvatar :name="card.name" :color="card.color" :size="48" />
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-[20px] font-semibold leading-tight">{{ card.name }}</span>
      <span
        class="truncate text-[24px] font-medium leading-tight"
        :class="card.sleep?.kind === 'stale' ? 'text-orange-deep' : 'text-ink'"
      >
        {{ status }}
      </span>
    </div>
  </article>
</template>
