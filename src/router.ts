import { createRouter, createWebHistory } from 'vue-router'
import { useDisplayStore } from '@/session/displayStore'
import type { DisplayState } from '@/session/displaySession'

declare module 'vue-router' {
  interface RouteMeta {
    requires?: DisplayState['kind']
  }
}

const HOME_FOR: Record<DisplayState['kind'], string> = {
  unregistered: '/setup',
  registered: '/home',
  revoked: '/removed',
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/setup', component: () => import('@/features/setup/SetupWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/join', component: () => import('@/features/setup/JoinWizard.vue'), meta: { requires: 'unregistered' } },
    { path: '/removed', component: () => import('@/features/display/DisplayRemoved.vue'), meta: { requires: 'revoked' } },
    { path: '/home', component: () => import('@/features/home/HomePlaceholder.vue'), meta: { requires: 'registered' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const state = await useDisplayStore().ensure()
  if (to.meta.requires && to.meta.requires !== state.kind) return HOME_FOR[state.kind]
  return true
})
