<script setup lang="ts">
/** Avatar radiogroup for picking which child a log entry is for (spec §7.4). */
import type { SnapshotChild } from '@/data/snapshot'
import RAvatar from '@/ui/RAvatar.vue'

defineProps<{ children: SnapshotChild[] }>()
const model = defineModel<string | null>({ required: true })
</script>

<template>
  <div v-if="children.length === 0" role="status">
    <slot name="empty" />
  </div>
  <div v-else role="radiogroup" aria-label="Child" class="flex flex-wrap gap-4">
    <button
      v-for="child in children"
      :key="child.id"
      type="button"
      role="radio"
      :aria-checked="model === child.id"
      class="flex flex-col items-center gap-2 rounded-[var(--radius-control)] border-4 p-1"
      :class="model === child.id ? 'border-ink' : 'border-transparent'"
      @click="model = child.id"
    >
      <RAvatar :name="child.name" :color="child.color" :size="72" />
      <span class="text-[22px] font-medium text-ink">{{ child.name }}</span>
    </button>
  </div>
</template>
