import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, '..'),
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
