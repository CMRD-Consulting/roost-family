<script setup lang="ts">
/** Naming a shopping list (kitchen spec §3.2): one field, used for both "+ New list" and Rename. */
import { ref, watch } from 'vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import { MAX_LIST_NAME, cleanListName } from './shoppingModel'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** "New list" or "Rename list". */
    title: string
    /** The name the field starts with (the current one, when renaming). */
    initial?: string
  }>(),
  { initial: '' },
)
const emit = defineEmits<{ close: []; save: [name: string] }>()

const name = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) name.value = props.initial
  },
  { immediate: true },
)

function save(): void {
  const clean = cleanListName(name.value)
  if (clean.length === 0) return
  emit('save', clean)
}
</script>

<template>
  <RSheet :title="title" :open="open" @close="emit('close')">
    <form data-testid="list-name-form" class="flex flex-col gap-5" @submit.prevent="save">
      <RInput v-model="name" data-testid="list-name" label="List name" :maxlength="MAX_LIST_NAME" />
    </form>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="cleanListName(name).length === 0" @click="save">Save</RButton>
    </template>
  </RSheet>
</template>
