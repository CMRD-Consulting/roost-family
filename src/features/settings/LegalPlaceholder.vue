<script setup lang="ts">
/** /privacy and /terms until the documents are published. Back returns to Settings (or the main screen). */
import { useRouter } from 'vue-router'
import RButton from '@/ui/RButton.vue'

defineProps<{ title: string }>()
const router = useRouter()

function back(): void {
  void router.push('/settings/about')
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-app px-10 text-center text-ink">
    <h1 class="text-[32px] font-semibold">{{ title }}</h1>
    <p class="text-[22px] text-ink-2">Coming before launch</p>
    <RButton variant="secondary" @click="back">Back</RButton>
  </main>
</template>
