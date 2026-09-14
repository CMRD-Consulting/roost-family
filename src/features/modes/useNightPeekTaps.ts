import { onBeforeUnmount, onMounted } from 'vue'
import { useModesStore } from '@/stores/modesStore'

/**
 * While the calling household screen is mounted, every tap anywhere on it during a night peek restarts the
 * 60 s peek from that tap (spec §7.7), so Night Mode never cuts in on an adult who is still using the screen.
 *
 * A plain capturing DOM listener rather than a Vue `@pointerdown.capture`: Vue stamps each event the first
 * time one of its handlers sees it and skips handlers attached at or after that stamp, which a template
 * listener on the screen's root would do to every child handler in the same tick.
 */
export function useNightPeekTaps(): void {
  const modes = useModesStore()
  const onPointerDown = (): void => modes.extendPeek()
  onMounted(() => window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true }))
  onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown, { capture: true }))
}
