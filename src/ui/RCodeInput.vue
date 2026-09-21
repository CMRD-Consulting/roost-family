<script setup lang="ts">
/**
 * A short code typed into one box per character: invite codes and emailed 6-digit codes (spec §4 — big,
 * unmistakable targets). The boxes mirror the value; a single transparent input on top takes typing, paste
 * and autofill, so one-time-code autofill and password managers still work.
 */
import { computed, ref, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Visually hidden, but read by screen readers and used by tests. */
    label: string
    length?: number
    /** `digits` accepts 0-9; `code` accepts letters and numbers, shown uppercase. */
    mode?: 'digits' | 'code'
    autocomplete?: string
  }>(),
  { length: 6, mode: 'digits', autocomplete: 'off' },
)

const emit = defineEmits<{ submit: [] }>()
const value = defineModel<string>({ required: true })

const id = useId()
const focused = ref(false)
const activeBox = computed(() => Math.min(value.value.length, props.length - 1))

function normalize(raw: string): string {
  const stripped = props.mode === 'digits' ? raw.replace(/\D+/g, '') : raw.replace(/[^A-Za-z0-9]+/g, '').toUpperCase()
  return stripped.slice(0, props.length)
}

function setCode(input: HTMLInputElement, raw: string): void {
  const code = normalize(raw)
  value.value = code
  // The input holds the raw keystrokes until we write the normalized value back.
  if (input.value !== code) input.value = code
}

function onInput(e: Event): void {
  const input = e.target as HTMLInputElement
  setCode(input, input.value)
}

function onPaste(e: ClipboardEvent): void {
  const text = e.clipboardData?.getData('text')
  if (text == null) return
  e.preventDefault()
  setCode(e.target as HTMLInputElement, text)
}
</script>

<template>
  <div class="relative w-fit">
    <label :for="id" class="sr-only">{{ label }}</label>
    <div class="flex gap-3" aria-hidden="true">
      <span
        v-for="i in length"
        :key="i"
        class="flex h-[88px] w-[72px] items-center justify-center rounded-[var(--radius-control)] border-2 bg-surface text-[40px] font-semibold text-ink tabular-nums"
        :class="focused && activeBox === i - 1 ? 'border-orange-deep outline-3 outline-offset-2 outline-orange-deep' : 'border-ink-3'"
      >
        {{ value[i - 1] ?? '' }}
      </span>
    </div>
    <input
      :id="id"
      :value="value"
      :maxlength="length"
      type="text"
      :inputmode="mode === 'digits' ? 'numeric' : 'text'"
      :autocapitalize="mode === 'digits' ? 'off' : 'characters'"
      :autocomplete="autocomplete"
      autocorrect="off"
      spellcheck="false"
      class="r-code-input absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
      @input="onInput"
      @paste="onPaste"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.enter="emit('submit')"
    />
  </div>
</template>

<style scoped>
/* Keep selection highlights from painting over the mirrored boxes. */
.r-code-input::selection {
  background: transparent;
}
</style>
