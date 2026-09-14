<script setup lang="ts">
/** A form's Save button with its error and the short "Saved" confirmation. */
import RButton from '@/ui/RButton.vue'

defineProps<{ saving: boolean; saved: boolean; disabled?: boolean; error: string | null }>()
const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>
    <div class="flex items-center gap-4">
      <RButton :disabled="disabled || saving" @click="emit('save')">
        {{ saving ? 'Saving…' : 'Save' }}
      </RButton>
      <p role="status" aria-live="polite" class="text-[18px] font-medium text-green-deep">
        <span v-if="saved">Saved</span>
      </p>
    </div>
  </div>
</template>
