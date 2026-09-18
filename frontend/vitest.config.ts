import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose.
//
// The dev server config is full of Docker-specific concerns -- host binding, CORS for the
// cross-origin module loads, the HMR websocket port -- none of which apply to a test run,
// and some of which (strictPort, allowedHosts) would make a test run fail for reasons that
// have nothing to do with the tests. Tailwind is absent for the same reason: tests assert
// behaviour and accessible structure, never compiled class output.
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
        @platejs/yjs is not installed until `./dev npm install` has been run
        after the package was added to package.json. The stub provides a no-op
        YjsPlugin so the test suite can run in the meantime. Remove this alias
        (and the stub file) once the package is installed.
      */
      '@platejs/yjs/react': fileURLToPath(
        new URL('./src/lib/platejs-yjs-stub.ts', import.meta.url),
      ),
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Reported per file rather than as a single running total, so a failure names the
    // feature it came from in CI output.
    reporters: ['default'],
  },
})
