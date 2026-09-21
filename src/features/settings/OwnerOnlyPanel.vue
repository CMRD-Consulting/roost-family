<script setup lang="ts">
/**
 * What an owner-only section shows on a display to an adult who is not an owner (spec §6.3). The Settings PIN
 * authorises every action here, so there is no other sign-in to offer: the section simply says the action is an
 * owner's. `notice` explains a change that just happened, such as the owner making themself an adult.
 */
import { nextTick, useTemplateRef, watch } from 'vue'

const props = defineProps<{ purpose: string; notice?: string | null }>()
const heading = useTemplateRef<HTMLElement>('heading')

// Moves focus here when the section stops offering owner actions mid-visit, as the sign-in panel does.
watch(
  () => props.notice,
  async (message) => {
    if (!message) return
    await nextTick()
    heading.value?.focus()
  },
)
</script>

<template>
  <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5" data-testid="owner-only">
    <p v-if="notice" role="status" class="text-[18px] font-medium text-ink-2">{{ notice }}</p>
    <h3 ref="heading" tabindex="-1" class="text-[20px] font-medium text-ink outline-none">Only an owner can {{ purpose }}.</h3>
  </div>
</template>
