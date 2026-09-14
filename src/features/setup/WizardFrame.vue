<script setup lang="ts">
import RLogo from '@/ui/RLogo.vue'
import RButton from '@/ui/RButton.vue'

defineProps<{ title: string; subtitle?: string; error?: string | null; canGoBack?: boolean }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <main class="flex min-h-dvh flex-col bg-app px-10 py-8">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-3 text-ink">
        <RLogo :size="34" />
        <span class="text-[24px] font-medium">roost family</span>
      </div>
      <RButton v-if="canGoBack" variant="ghost" @click="$emit('back')">← Back</RButton>
    </header>
    <section class="mx-auto mt-10 flex w-full max-w-[720px] flex-1 flex-col gap-6">
      <h1 class="text-[44px] leading-tight font-semibold">{{ title }}</h1>
      <p v-if="subtitle" class="text-[20px] text-ink-2">{{ subtitle }}</p>
      <p v-if="error" role="alert" class="rounded-[18px] bg-orange-tint px-5 py-4 text-[18px] text-warn-ink">{{ error }}</p>
      <slot />
    </section>
  </main>
</template>
