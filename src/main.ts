import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import './styles/app.css'
import App from './App.vue'
import { router } from './router'
import { unlockAudio } from './ui/sound'

// Browsers only allow audio after a user gesture; unlock it on the first touch.
window.addEventListener('pointerdown', unlockAudio, { once: true })

createApp(App).use(createPinia()).use(router).mount('#app')
