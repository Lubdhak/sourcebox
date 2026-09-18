import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Standalone Vite project. Nothing here knows about Rails.
//
// The contract with the backend is exactly two things:
//   1. `dist/manifest.json` — maps entry names to hashed output files. Rails reads this
//      to render <script> and <link> tags.
//   2. the URL this is served from — the backend's ASSET_HOST in production, or
//      VITE_DEV_SERVER_URL in development.
//
// That is the whole interface, which is what allows this directory to become its own
// repository: no Ruby gem drives the build, and no Rails config is read.

function envEnabled(name: string): boolean {
  const value = process.env[name]
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

const hotReload = envEnabled('FRONTEND_HOT_RELOAD')

function hmrClientPort(origin: string): number {
  const url = new URL(origin)
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
        @platejs/yjs is declared in package.json but not yet installed.
        This alias resolves it to a no-op stub so the app loads while
        `./dev npm install` has not been run yet.

        The stub provides a valid (but inert) YjsPlugin: the editor renders
        and saves normally in single-user mode. Real-time collaboration is
        restored the moment @platejs/yjs is installed — remove this alias
        and the matching one in vitest.config.ts at that point.
      */
      '@platejs/yjs/react': fileURLToPath(
        new URL('./src/lib/platejs-yjs-stub.ts', import.meta.url),
      ),
    },
  },

  // Asset URLs in the manifest stay root-relative ("assets/application-abc123.js").
  // Rails joins them onto ASSET_HOST, so the same build artefact works behind any
  // origin or CDN without rebuilding.
  base: '/',

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    // A string puts the manifest at dist/manifest.json instead of the default
    // dist/.vite/manifest.json. It is served over HTTP to the backend, and a path
    // segment starting with a dot is the kind of thing web servers are configured to
    // deny.
    manifest: 'manifest.json',

    // Explicit entry, because there is no index.html. The backend renders the HTML, so
    // this project builds a library of entrypoints rather than a page.
    rollupOptions: {
      input: {
        application: fileURLToPath(new URL('./src/entrypoints/application.tsx', import.meta.url)),
      },
    },

    // Shipped so production stack traces are readable. These are separate .map files
    // that browsers fetch only when devtools are open.
    sourcemap: true,
  },

  server: {
    // Must be 0.0.0.0, not localhost: bound to localhost inside a container the port is
    // unreachable from the host even when published.
    host: '0.0.0.0',
    port: 5173,

    // Fail loudly instead of silently moving to 5174, which would leave the backend
    // pointing at a dead port.
    strictPort: true,

    // The browser loads the HTML from the Rails origin (:3000) and the JS modules from
    // here (:5173), so every module request is cross-origin. Without this the browser
    // blocks them and the page renders blank.
    cors: true,

    // Makes Vite emit absolute URLs for assets it references from inside CSS and JS.
    // Relative URLs would resolve against the Rails origin and 404.
    origin: process.env.VITE_DEV_ORIGIN ?? 'http://localhost:5173',

    // Vite rejects requests whose Host header it does not recognise. In Docker the
    // service is reached as `frontend` from the backend network as well as `localhost`
    // from the browser.
    allowedHosts: ['localhost', '127.0.0.1', 'frontend'],

    // FRONTEND_HOT_RELOAD=true turns on HMR. Off by default: Docker Desktop's virtiofs
    // does not deliver inotify, so the watcher has to poll, and a polling watcher with
    // no HMR client is wasted CPU. Reload the page, or `./dev restart frontend`, when
    // it is off.
    //
    // Vite 8 moved the websocket settings to `server.ws`. The HTML is served from
    // Rails (:3000), so without clientPort the client would open ws://localhost:3000
    // and HMR would never connect.
    hmr: hotReload,
    ws: hotReload
      ? {
          host: 'localhost',
          protocol: 'ws',
          clientPort: hmrClientPort(process.env.VITE_DEV_ORIGIN ?? 'http://localhost:5173'),
        }
      : false,

    watch: hotReload
      ? {
          usePolling: true,
          interval: 300,
        }
      : {
          ignored: ['**/*'],
        },
  },
})
