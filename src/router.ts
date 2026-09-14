import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { recoverFromChunkError } from '@/app/appUpdates'
import KidsCorner from '@/features/corner/KidsCorner.vue'
import MainScreen from '@/features/main/MainScreen.vue'
import { requestManageExport } from '@/features/manage/manageApi'
import { hasPendingInvite } from '@/features/settings/pendingInvite'
import { useDisplayStore, type DisplayStoreKind, type DisplayStoreState } from '@/session/displayStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'

declare module 'vue-router' {
  interface RouteMeta {
    requires?: DisplayStoreKind
    /** Only reachable with an open settings session (entered with an adult PIN on the main screen). */
    settingsSession?: boolean
    /** Leaving Settings for this route keeps the settings session open (e.g. About's policy pages). */
    keepsSettingsSession?: boolean
    /** Only reachable with a member invite just made in Settings > Members (the add-adult hand-off). */
    pendingInvite?: boolean
    /** Reachable on any device with no display registration and no display checks (the Take list phone page,
     *  Manage household). */
    public?: boolean
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
    {
      path: '/settings/:section?',
      component: () => import('@/features/settings/SettingsShell.vue'),
      meta: { requires: 'registered', settingsSession: true },
    },
    // Add an adult (spec §6.4): full screen, outside Settings; the Settings session has already ended.
    {
      path: '/join-adult',
      component: () => import('@/features/settings/JoinAdultFlow.vue'),
      meta: { requires: 'registered', pendingInvite: true },
    },
    {
      path: '/privacy',
      component: () => import('@/features/settings/LegalPlaceholder.vue'),
      props: { title: 'Privacy policy' },
      meta: { keepsSettingsSession: true },
    },
    {
      path: '/terms',
      component: () => import('@/features/settings/LegalPlaceholder.vue'),
      props: { title: 'Terms' },
      meta: { keepsSettingsSession: true },
    },
    // The Take list phone page (spec §7.8): opened from a QR code on a phone, never on a display.
    {
      path: '/list/:token',
      component: () => import('@/features/takelist/TakeListPage.vue'),
      props: true,
      meta: { public: true },
    },
    // Manage household (spec §7.10): any browser, phone or laptop, that is not a display. It signs an adult in on a
    // temporary client of its own and never reads or starts the display session.
    {
      path: '/manage',
      component: () => import('@/features/manage/ManageHousehold.vue'),
      props: { onRequestExport: requestManageExport },
      meta: { public: true },
    },
    // The emailed export link (spec §11.3): the owner signs in again here to download.
    {
      path: '/manage/export/:id',
      component: () => import('@/features/manage/ExportDownload.vue'),
      props: true,
      meta: { public: true },
    },
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

/** Settings routes need an open settings session (plan 3c Decisions); without one they go back to /home. */
export function resolveSettingsRoute(to: Pick<RouteLocationNormalized, 'meta'>, hasSettingsSession: boolean): true | string {
  return to.meta.settingsSession && !hasSettingsSession ? '/home' : true
}

/** The add-adult flow needs the invite Settings > Members just made (held in memory only); otherwise /home. */
export function resolveJoinAdultRoute(to: Pick<RouteLocationNormalized, 'meta'>, invitePending: boolean): true | string {
  return to.meta.pendingInvite && !invitePending ? '/home' : true
}

/** Public routes skip the display guards entirely: they must not start or check a display session. */
export function isPublicRoute(to: Pick<RouteLocationNormalized, 'meta'>): boolean {
  return to.meta.public === true
}

router.beforeEach(async (to) => {
  if (isPublicRoute(to)) return true
  const store = useDisplayStore()
  let state: DisplayStoreState
  try {
    state = await store.ensure()
  } catch {
    state = { kind: 'offline' }
  }
  const display = resolveDisplayRoute(to, state, store.lastKnown?.kind ?? null)
  if (display !== true) return display
  const settings = resolveSettingsRoute(to, useSettingsSessionStore().info !== null)
  if (settings !== true) return settings
  return resolveJoinAdultRoute(to, hasPendingInvite())
})

// A lazy route chunk that fails to load (stale build after a deploy, or no network) reloads to /home once;
// a public page (a phone that has no /home) reloads itself instead.
router.onError((error, to) => {
  recoverFromChunkError(error, window.sessionStorage, (url) => window.location.assign(isPublicRoute(to) ? to.fullPath : url))
})
