<script setup lang="ts">
import { useRouter } from 'vue-router'
import RLogo from '@/ui/RLogo.vue'
import RButton from '@/ui/RButton.vue'

defineEmits<{ next: [] }>()
const router = useRouter()
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-app px-10 text-center">
    <span class="text-orange"><RLogo :size="120" /></span>
    <h1 class="text-[56px] font-semibold">roost family</h1>
    <p class="max-w-[520px] text-[22px] text-ink-2">The kitchen screen for the baby and toddler years.</p>
    <div class="flex flex-col gap-4">
      <RButton tier="moment" @click="$emit('next')">Set up a household</RButton>
      <RButton tier="moment" variant="secondary" @click="router.push('/join')">Join a household</RButton>
    </div>
  </main>
</template>
