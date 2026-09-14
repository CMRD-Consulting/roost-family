<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import RLogo from '@/ui/RLogo.vue'

// The very first render, before the router has resolved its initial navigation, would otherwise be
// blank: show a splash instead so a cold boot (especially offline, reading the device cache) never
// flashes an empty screen.
const router = useRouter()
const ready = ref(false)
void router.isReady().then(() => {
  ready.value = true
})
</script>

<template>
  <div v-if="!ready" class="flex h-dvh items-center justify-center bg-app text-ink-3" role="status" aria-label="Loading">
    <RLogo :size="64" />
  </div>
  <RouterView v-else />
</template>
