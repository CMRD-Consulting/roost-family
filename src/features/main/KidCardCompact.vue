<script setup lang="ts">
import { computed } from 'vue'
import RAvatar from '@/ui/RAvatar.vue'
import type { KidCardModel } from './mainScreenModel'

const props = defineProps<{ card: KidCardModel }>()
const emit = defineEmits<{ fixSleep: [childId: string] }>()

const status = computed(() => props.card.sleep?.label ?? props.card.nowNext?.now?.label ?? props.card.ageLabel)
</script>

<template>
  <!-- With a forgotten open sleep, the whole card is a 60 px+ button that opens "Still sleeping?". -->
  <component
    :is="card.sleep?.kind === 'stale' ? 'button' : 'article'"
    :type="card.sleep?.kind === 'stale' ? 'button' : undefined"
    data-testid="kid-card-compact"
    class="flex min-h-[60px] min-w-0 items-center gap-3 rounded-[18px] border-l-8 bg-surface px-4 py-1 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
    :style="{ borderLeftColor: card.color }"
    @click="card.sleep?.kind === 'stale' && emit('fixSleep', card.childId)"
  >
    <RAvatar :name="card.name" :color="card.color" :size="40" />
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-[20px] font-semibold leading-tight">{{ card.name }}</span>
      <span
        class="truncate text-[24px] font-medium leading-tight"
        :class="card.sleep?.kind === 'stale' ? 'text-orange-deep' : 'text-ink'"
      >
        {{ status }}
      </span>
    </div>
  </component>
</template>
