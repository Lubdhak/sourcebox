import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [RubyPlugin(), react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'app/frontend'),
    },
  },

  server: {
    // Inside Docker the dev server binds 0.0.0.0 (see config/vite.json), but the
    // browser resolves the HMR websocket from the host, so it must be told
    // `localhost` explicitly or HMR silently fails to connect.
    hmr: {
      host: process.env.VITE_HMR_HOST ?? 'localhost',
    },
  },
})
