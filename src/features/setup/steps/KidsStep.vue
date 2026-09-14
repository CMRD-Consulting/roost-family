<script setup lang="ts">
import { ref } from 'vue'
import WizardFrame from '../WizardFrame.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import RAvatar from '@/ui/RAvatar.vue'
import { PERSON_COLORS } from '@/ui/personPalette'
import { householdDate } from '@/domain/time'
import { validateKids } from '../validation'
import type { WizardState } from '../wizardState'

const props = defineProps<{ state: WizardState }>()
const emit = defineEmits<{ next: []; back: [] }>()
const error = ref<string | null>(null)

function addKid() {
  const used = new Set(props.state.kids.map((k) => k.color))
  const color = PERSON_COLORS.find((c) => !used.has(c) && c !== props.state.color) ?? PERSON_COLORS[0]
  props.state.kids.push({ name: '', birthday: '', color })
}

if (props.state.kids.length === 0) addKid()

function submit() {
  error.value = validateKids(props.state.kids, householdDate(new Date(), props.state.timeZone))
  if (!error.value) emit('next')
}
</script>

<template>
  <WizardFrame title="Your kids" subtitle="Features turn on by age, so birthdays matter." :error="error" can-go-back @back="emit('back')">
    <div v-for="(kid, i) in state.kids" :key="i" class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-6">
      <div class="flex items-center gap-4">
        <RAvatar :name="kid.name || '?'" :color="kid.color" :size="56" />
        <div class="flex-1"><RInput v-model="kid.name" label="Name" /></div>
        <RButton v-if="state.kids.length > 1" variant="ghost" :aria-label="`Remove ${kid.name || 'child'}`" @click="state.kids.splice(i, 1)">✕</RButton>
      </div>
      <RInput v-model="kid.birthday" label="Birthday" type="date" />
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        <button
          v-for="c in PERSON_COLORS"
          :key="c"
          type="button"
          role="radio"
          :aria-checked="kid.color === c"
          :aria-label="`Color ${c}`"
          class="size-11 rounded-full border-4"
          :class="kid.color === c ? 'border-ink' : 'border-transparent'"
          :style="{ background: c }"
          @click="kid.color = c"
        />
      </div>
    </div>
    <RButton v-if="state.kids.length < 8" variant="secondary" @click="addKid">+ Add another child</RButton>
    <RButton @click="submit">Continue</RButton>
  </WizardFrame>
</template>
