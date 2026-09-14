import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { recoverFromChunkError } from '@/app/appUpdates'
import KidsCorner from '@/features/corner/KidsCorner.vue'
import MainScreen from '@/features/main/MainScreen.vue'
import { useDisplayStore, type DisplayStoreKind, type DisplayStoreState } from '@/session/displayStore'

declare module 'vue-router' {
  interface RouteMeta {
    requires?: DisplayStoreKind
  }
}

const HOME_FOR: Record<DisplayStoreKind, string> = {
  unregistered: '/setup',
  registered: '/home',
  revoked: '/removed',
  offline: '/offline',
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/setup', component: () => import('@/features/setup/SetupWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/join', component: () => import('@/features/setup/JoinWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/removed', component: () => import('@/features/display/DisplayRemoved.vue'), meta: { requires: 'revoked' } },
    { path: '/offline', component: () => import('@/features/display/DisplayOffline.vue'), meta: { requires: 'offline' } },
    // The household screens are bundled eagerly, not lazily: a registered tablet must reach them with no
    // network even if its service worker precache were missing (spec §13).
    { path: '/home', component: MainScreen, meta: { requires: 'registered' } },
    { path: '/corner', component: KidsCorner, meta: { requires: 'registered' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/**
 * Where a navigation to `to` should go given the display state. While offline, a tablet whose last
 * known state was registered stays on its registered screens (spec §13: keep working); otherwise
 * it waits on /offline.
 */
export function resolveDisplayRoute(
  to: Pick<RouteLocationNormalized, 'meta'>,
  state: DisplayStoreState,
  lastKnownKind: DisplayStoreKind | null,
): true | string {
  if (state.kind === 'offline' && lastKnownKind === 'registered' && to.meta.requires === 'registered') return true
  if (to.meta.requires && to.meta.requires !== state.kind) return HOME_FOR[state.kind]
  return true
}

router.beforeEach(async (to) => {
  const store = useDisplayStore()
  let state: DisplayStoreState
  try {
    state = await store.ensure()
  } catch {
    state = { kind: 'offline' }
  }
  return resolveDisplayRoute(to, state, store.lastKnown?.kind ?? null)
})

// A lazy route chunk that fails to load (stale build after a deploy, or no network) reloads to /home once.
router.onError((error) => {
  recoverFromChunkError(error, window.sessionStorage, (url) => window.location.assign(url))
})
