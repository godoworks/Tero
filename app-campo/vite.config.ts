// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// La aplicacion se publica dentro del sitio del proyecto, junto a la
// presentacion: https://godoworks.github.io/Tero/app/
const BASE = '/Tero/app/'

export default defineConfig({
  base: BASE,
  build: {
    // Se construye directamente sobre la carpeta que publica GitHub Pages.
    outDir: fileURLToPath(new URL('../docs/app', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Tero · Inspecciones municipales',
        short_name: 'Tero',
        description: 'Inspecciones municipales en campo, con y sin conexion',
        lang: 'es-UY',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#F2F4F2',
        theme_color: '#12212E',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El inspector tiene que poder abrir la aplicacion sin señal, asi que
        // todo lo que necesita para funcionar se guarda en el dispositivo.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: BASE + 'index.html',
        runtimeCaching: [
          {
            // Teselas del mapa: se guardan las que el inspector ya vio, para
            // que el mapa siga sirviendo en la zona donde estuvo trabajando.
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'teselas-mapa',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
