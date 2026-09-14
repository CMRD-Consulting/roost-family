<script setup lang="ts">
/** "Who's playing?" (spec §7.5): one big avatar per child with Kids' Corner enabled. */
import type { SnapshotChild } from '@/data/snapshot'
import RAvatar from '@/ui/RAvatar.vue'

defineProps<{ children: SnapshotChild[] }>()
const emit = defineEmits<{ pick: [childId: string] }>()
</script>

<template>
  <section class="flex h-full flex-col items-center justify-center gap-12 px-10">
    <h1 class="text-[36px] font-semibold text-ink-2">Who's playing?</h1>
    <ul class="flex max-w-[900px] flex-wrap justify-center gap-12">
      <li v-for="child in children" :key="child.id">
        <button
          type="button"
          data-testid="corner-child"
          :aria-label="child.name"
          class="flex flex-col items-center gap-4 rounded-[28px] p-2 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink-2"
          @click="emit('pick', child.id)"
        >
          <span class="rounded-full" style="box-shadow: 0 20px 50px rgba(90, 70, 54, 0.2)">
            <RAvatar :name="child.name" :color="child.color" :size="160" decorative />
          </span>
          <span class="text-[32px] font-semibold text-ink-2">{{ child.name }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
