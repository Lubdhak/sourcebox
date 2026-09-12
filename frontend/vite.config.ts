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
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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

    // No HMR. The browser never refreshes on its own and never opens an HMR websocket;
    // reload the page to see a change, and restart the container to rebuild the module
    // graph:
    //
    //     ./dev restart frontend
    //
    // Vite still serves and transforms modules on request, so this remains a dev server
    // rather than a static build — source maps, JSX and TS transforms all still work.
    hmr: false,

    // Stop watching the filesystem entirely. This is the setting that actually matters
    // for CPU: reaching a bind mount through Docker Desktop's virtiofs makes inotify
    // unreliable, so the watcher had to poll, and polling every 300ms over a shared
    // volume is a constant background cost. With HMR off, a watcher would burn that cost
    // to notify a client that no longer exists.
    watch: {
      ignored: ['**/*'],
    },
  },
})
