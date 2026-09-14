import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import './styles/app.css'
import App from './App.vue'
import { startAppUpdates } from './app/appUpdates'
import { initErrorTracking } from './app/errorTracking'
import { getRedactionTerms } from './app/redactionTerms'
import { router } from './router'
import { unlockAudio } from './ui/sound'

// Browsers only allow audio after a user gesture; unlock it on the first touch.
window.addEventListener('pointerdown', unlockAudio, { once: true })

const pinia = createPinia()
const app = createApp(App)
app.use(pinia).use(router)

// Optional error tracking (spec §5.9): a no-op unless VITE_SENTRY_DSN is set, and the Sentry SDK is
// only imported (dynamically, inside initErrorTracking) when it is, so the bundle stays small without it.
if (import.meta.env.VITE_SENTRY_DSN) {
  initErrorTracking(app, router, getRedactionTerms)
}

app.mount('#app')

// Service worker registration and safe-moment app updates (spec §5.8). Not in dev: no worker is built there.
if (import.meta.env.PROD) {
  startAppUpdates(router).catch((e: unknown) => console.warn('App updates unavailable', e))
}
