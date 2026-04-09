import { defineConfig } from 'vite'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: resolve(__dirname, '..'),
  base: process.env.VITE_BASE_URL || '/',
  publicDir: resolve(__dirname, '../public'),
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      workbox: {
        // Cache l'app shell + assets statiques
        globPatterns: ['**/*.{js,css,html,png,webp,woff2}'],
        // Activation immédiate du nouveau SW sans attendre la fermeture de tous les onglets
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Supabase API → toujours réseau (pas de cache)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/ptzmyuugxhsbrynjwlhp\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
        ],
      },
      manifest: {
        name: 'Vitalia — Mon espace bien-être',
        short_name: 'Vitalia',
        description: 'Ton plan nutrition personnalisé selon tes symptômes et objectifs bien-être',
        theme_color: '#C4714A',
        background_color: '#FAF7F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: (process.env.VITE_BASE_URL || '/') + 'home.html',
        scope: process.env.VITE_BASE_URL || '/',
        lang: 'fr',
        icons: [
          { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  build: {
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home:       resolve(__dirname, '../home.html'),
        onboarding: resolve(__dirname, '../onboarding.html'),
      }
    }
  },
  server: {
    port: 5173,
    open: '/home.html',
  },
})
