import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
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
    { path: '/home', component: () => import('@/features/home/HomePlaceholder.vue'), meta: { requires: 'registered' } },
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
