<script setup lang="ts">
defineProps<{ message: string | null }>()
</script>

<template>
  <p v-if="message" role="alert" class="rounded-[var(--radius-control)] bg-orange-tint px-5 py-4 text-[18px] text-warn-ink">
    {{ message }}
  </p>
</template>
