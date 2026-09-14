import { ref, type Ref } from 'vue'

/**
 * Roving-tabindex radiogroup keyboard support (like `RChips`): only the selected option (or the first,
 * when none is) is in the tab order, and arrow keys move both the selection and focus, wrapping around.
 * Bind `ref="optionRefs"` on the options, `:tabindex="tabindexFor(i)"` and `@keydown="onKeydown($event, i)"`.
 */
export function useRovingRadio<T extends string>(values: () => T[], model: Ref<T | null | undefined>) {
  const optionRefs = ref<HTMLElement[]>([])

  function tabindexFor(index: number): 0 | -1 {
    const selected = values().indexOf(model.value as T)
    return index === (selected === -1 ? 0 : selected) ? 0 : -1
  }

  function onKeydown(e: KeyboardEvent, index: number): void {
    const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!isNext && !isPrev) return
    const all = values()
    if (all.length === 0) return
    e.preventDefault()
    const next = (index + (isNext ? 1 : -1) + all.length) % all.length
    model.value = all[next]
    optionRefs.value[next]?.focus()
  }

  return { optionRefs, tabindexFor, onKeydown }
}
