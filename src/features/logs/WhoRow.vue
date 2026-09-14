<script setup lang="ts">
/** "Who?" row of adult avatars for attribution (spec §6.5, §7.4). Optional except on Medicine. */
import type { Member } from '@/data/snapshot'
import RAvatar from '@/ui/RAvatar.vue'
import { useRovingRadio } from '@/ui/useRovingRadio'

const props = defineProps<{ members: Member[]; required: boolean }>()
const model = defineModel<string | null>({ required: true })

const { optionRefs, tabindexFor, onKeydown } = useRovingRadio(() => props.members.map((m) => m.id), model)

function pick(member: Member): void {
  if (model.value === member.id) {
    if (!props.required) model.value = null
    return
  }
  model.value = member.id
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <span class="text-[18px] font-semibold tracking-wide text-ink-3 uppercase">
      Who?<span v-if="required" class="ml-1 normal-case text-orange-deep">(required)</span>
    </span>
    <div role="radiogroup" aria-label="Who" :aria-required="required ? 'true' : undefined" class="flex flex-wrap gap-3">
      <button
        v-for="(member, i) in members"
        :key="member.id"
        ref="optionRefs"
        type="button"
        role="radio"
        :aria-checked="model === member.id"
        :tabindex="tabindexFor(i)"
        class="flex min-h-[60px] items-center gap-2 rounded-full border-[3px] bg-surface-2 pr-4 pl-1"
        :class="model === member.id ? 'border-ink' : 'border-transparent'"
        @click="pick(member)"
        @keydown="onKeydown($event, i)"
      >
        <RAvatar :name="member.displayName" :color="member.color" :size="44" />
        <span class="text-[19px] font-medium text-ink">{{ member.displayName }}</span>
      </button>
    </div>
  </div>
</template>
