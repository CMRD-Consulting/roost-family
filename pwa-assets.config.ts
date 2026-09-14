import { defineConfig, type Preset } from '@vite-pwa/assets-generator/config'

/** The app background (--color-app), so icons are opaque on every launcher. */
const background = '#F5EEE3'

const preset: Preset = {
  transparent: { sizes: [192, 512], favicons: [[48, 'favicon.ico']], padding: 0.1, resizeOptions: { background } },
  maskable: { sizes: [512], padding: 0.3, resizeOptions: { background } },
  apple: { sizes: [180], padding: 0.2, resizeOptions: { background } },
}

// Regenerate the PNG icons in public/ from the Gable logo: `pnpm icons`.
export default defineConfig({ preset, images: ['public/logo.svg'] })
