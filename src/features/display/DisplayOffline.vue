<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import RLogo from '@/ui/RLogo.vue'
import { useDisplayStore } from '@/session/displayStore'

const RETRY_MS = 15_000

const router = useRouter()
const displayStore = useDisplayStore()
let timer: ReturnType<typeof setInterval> | undefined
let retrying = false

async function retry() {
  if (retrying) return
  retrying = true
  try {
    const state = await displayStore.refresh()
    // The router guard sends '/' to the right home for the new state.
    if (state.kind !== 'offline') await router.replace('/')
  } finally {
    retrying = false
  }
}

function onOnline() {
  void retry()
}

onMounted(() => {
  timer = setInterval(onOnline, RETRY_MS)
  window.addEventListener('online', onOnline)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('online', onOnline)
})
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-app px-10 text-center text-ink">
    <span class="text-orange"><RLogo :size="72" /></span>
    <h1 class="text-[44px] font-semibold">Can’t reach Roost Family</h1>
    <p class="text-[22px] text-ink-2" role="status" aria-live="polite">Retrying…</p>
  </main>
</template>
