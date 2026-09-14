<script setup lang="ts">
import { useRouter } from 'vue-router'
import RButton from '@/ui/RButton.vue'
import { displayClient } from '@/data/supabase'
import { resetDisplay } from '@/session/displaySession'
import { useDisplayStore } from '@/session/displayStore'

const router = useRouter()
const displayStore = useDisplayStore()

async function startOver() {
  await resetDisplay(displayClient)
  await displayStore.refresh()
  await router.replace('/setup')
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink px-10 text-center text-surface">
    <h1 class="text-[44px] font-semibold">This display was removed from the household</h1>
    <p class="max-w-[560px] text-[22px] text-surface/80">An owner removed it. You can set it up again.</p>
    <RButton tier="moment" @click="startOver">Start over</RButton>
  </main>
</template>
