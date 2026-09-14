import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import './styles/app.css'
import App from './App.vue'
import { startAppUpdates } from './app/appUpdates'
import { router } from './router'
import { unlockAudio } from './ui/sound'

// Browsers only allow audio after a user gesture; unlock it on the first touch.
window.addEventListener('pointerdown', unlockAudio, { once: true })

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')

// Service worker registration and safe-moment app updates (spec §5.8). Not in dev: no worker is built there.
if (import.meta.env.PROD) {
  startAppUpdates(router).catch((e: unknown) => console.warn('App updates unavailable', e))
}
