/// <reference types="vitest/config" />
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** The single-file build has no service worker: stub the PWA virtual module. */
const pwaRegisterStub = (): Plugin => ({
  name: 'pwa-register-stub',
  resolveId: (id) => (id === 'virtual:pwa-register' ? '\0pwa-register-stub' : null),
  load: (id) => (id === '\0pwa-register-stub' ? 'export const registerSW = () => () => Promise.resolve();' : null)
});

/** Publishes the single-file build as standalone-bundle.html (repo root + GitHub Pages). */
const publishStandalone = (outDir: string): Plugin => ({
  name: 'publish-standalone',
  apply: 'build',
  closeBundle() {
    const built = resolve(outDir, 'index.html');
    if (!existsSync(built)) return;
    copyFileSync(built, resolve(__dirname, 'standalone-bundle.html'));
    mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
    copyFileSync(built, resolve(__dirname, 'dist/standalone-bundle.html'));
  }
});

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  const standaloneOut = 'node_modules/.cache/standalone';

  return {
    // Relative base: works on https://engob.github.io/dotslines/ and on any other host.
    base: './',
    define: { __STANDALONE__: JSON.stringify(standalone), __APP_VERSION__: JSON.stringify(version) },
    build: standalone
      ? { outDir: standaloneOut, emptyOutDir: true, copyPublicDir: false }
      : { outDir: 'dist', emptyOutDir: true },
    worker: { format: 'es' },
    plugins: standalone
      ? [pwaRegisterStub(), viteSingleFile(), publishStandalone(standaloneOut)]
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
              id: './',
              name: 'Petits Carrés — Carnet de Croquis',
              short_name: 'Petits Carrés',
              description:
                'Jeu des petits carrés (Dots and Boxes) au style crayonné sur papier, jouable hors-ligne et sur 2 téléphones.',
              lang: 'fr',
              start_url: './',
              scope: './',
              theme_color: '#f6f2e9',
              background_color: '#f6f2e9',
              display: 'standalone',
              orientation: 'portrait',
              categories: ['games'],
              icons: [
                { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
              ]
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
              // The single-file copy is for download / file:// use, not needed offline.
              globIgnores: ['standalone-bundle.html'],
              cleanupOutdatedCaches: true
            }
          })
        ],
    test: {
      include: ['tests/**/*.test.ts'],
      testTimeout: 60000
    }
  };
});
