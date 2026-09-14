/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const APP_BACKGROUND = '#F5EEE3'

/** Shown in Settings > About: package.json version plus the short git commit, when this is a git checkout. */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return sha ? `${version} (${sha})` : version
  } catch {
    return version
  }
}

/**
 * Writes `dist/version.json` (spec §5.8): the running display polls this to notice a new deploy and,
 * when `critical` is set (via `ROOST_CRITICAL=1` on the build), reload sooner than the usual safe-moment
 * rules allow. Reuses the exact `__APP_VERSION__` string so the two only ever differ across a real build.
 * Must never be precached by the service worker (see the `workbox.globIgnores` entry below) and is always
 * fetched with `cache: 'no-store'` (src/app/appUpdates.ts) — a cached copy would defeat the whole check.
 */
function writeVersionJson(version: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'roost-write-version-json',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true })
      const payload = { version, critical: process.env.ROOST_CRITICAL === '1' }
      writeFileSync(join(outDir, 'version.json'), JSON.stringify(payload))
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
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
        // Never precached (spec §5.8): a cached copy would defeat the whole point of the version check.
        // Belt-and-braces alongside globPatterns not matching .json — see writeVersionJson() above.
        // (Workbox's own default ignore, node_modules, is restated here since passing globIgnores replaces it.)
        globIgnores: ['**/node_modules/**/*', 'version.json'],
        navigateFallback: 'index.html',
        // Supabase paths are never app routes (only relevant if the API is ever served from this origin).
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/realtime\//, /^\/storage\//],
        cleanupOutdatedCaches: true,
        // No runtimeCaching: Supabase API responses are never cached by the service worker (the device
        // cache in IndexedDB is the only offline copy of household data, and it's cleared on revoke).
      },
    }),
    writeVersionJson(appVersion()),
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
