/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const APP_BACKGROUND = '#F5EEE3'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // Installable web app (spec §5.2): a registered tablet boots with no network from the precache.
    VitePWA({
      // We decide when to reload (spec §5.8: only at a safe moment), so a new worker waits to be told.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Roost Family',
        short_name: 'Roost',
        display: 'standalone',
        orientation: 'landscape',
        background_color: APP_BACKGROUND,
        theme_color: APP_BACKGROUND,
        start_url: '/home',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Every built asset, including the self-hosted Outfit font files.
        globPatterns: ['**/*.{js,css,html,woff2,woff,svg,png,ico}'],
        navigateFallback: 'index.html',
        // Supabase paths are never app routes (only relevant if the API is ever served from this origin).
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/realtime\//, /^\/storage\//],
        cleanupOutdatedCaches: true,
        // No runtimeCaching: Supabase API responses are never cached by the service worker (the device
        // cache in IndexedDB is the only offline copy of household data, and it's cleared on revoke).
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'safari16' },
  server: { host: true, port: 5173 },
  test: {
    environment: 'jsdom',
    // supabase/functions/_shared/** is plain TS shared with the Deno Edge Function (spec §5.6);
    // Vitest runs its tests directly rather than through the Deno test runner.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
})
