<script setup lang="ts">
/**
 * "Saved" toast with Undo, shown for the 10-second undo window after a save (spec §7.3). Undoing a dose
 * needs an adult PIN, so it emits `needsPin` with the dose id for the parent to open the PIN pad.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useLogStore } from '@/stores/logStore'

const emit = defineEmits<{ needsPin: [doseId: string] }>()

const ERROR_MS = 4_000

const logStore = useLogStore()
const undoing = ref(false)
const error = ref<string | null>(null)
let errorTimer: ReturnType<typeof setTimeout> | undefined

const action = computed(() => logStore.lastAction)
const message = computed(() => (action.value?.queueKey != null ? 'Saved offline — will sync' : 'Saved'))

function showError(text: string): void {
  error.value = text
  clearTimeout(errorTimer)
  errorTimer = setTimeout(() => (error.value = null), ERROR_MS)
}

async function undo(): Promise<void> {
  const current = action.value
  if (!current || undoing.value) return
  undoing.value = true
  error.value = null
  try {
    const result = await logStore.undo()
    if (result === 'needsPin' && current.command.kind === 'dose.add') emit('needsPin', current.command.entry.id)
  } catch {
    showError("Couldn't undo that.")
  } finally {
    undoing.value = false
  }
}

onBeforeUnmount(() => clearTimeout(errorTimer))
</script>

<template>
  <div role="status" aria-live="polite" class="flex h-full items-center justify-center">
    <div
      v-if="action"
      data-testid="undo-toast"
      class="flex h-[60px] items-center gap-5 rounded-full bg-ink pl-7 text-surface shadow-[0_12px_30px_rgba(0,0,0,0.25)]"
    >
      <span class="whitespace-nowrap text-[22px] font-medium">{{ message }}</span>
      <button
        type="button"
        class="h-[60px] min-w-[120px] rounded-full bg-orange px-6 text-[22px] font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-surface disabled:opacity-60"
        :disabled="undoing"
        @click="undo"
      >
        Undo
      </button>
    </div>
    <p
      v-else-if="error"
      class="flex h-[60px] items-center rounded-full bg-ink px-7 text-[22px] font-medium text-surface"
    >
      {{ error }}
    </p>
  </div>
</template>
