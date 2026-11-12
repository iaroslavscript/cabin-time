import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the app works from any path (e.g. GitHub Pages project sites).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      pwaAssets: {
        image: 'public/favicon.svg',
        preset: 'minimal-2023',
        overrideManifestIcons: true,
      },
      manifest: {
        id: './',
        name: 'Cabin Crew Call',
        short_name: 'Crew Call',
        description: 'An airplane overhead passenger service unit: reading lights, air vents and the cabin crew call button.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#2b2f36',
        theme_color: '#2b2f36',
        categories: ['entertainment', 'games'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,mp3,wav,json}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
