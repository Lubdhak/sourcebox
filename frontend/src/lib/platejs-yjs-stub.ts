/**
 * Stub for @platejs/yjs/react — used until the package is installed.
 *
 * @platejs/yjs is listed in package.json but requires `./dev npm install`
 * to land in node_modules. Until that happens, both the Vite dev server and
 * Vitest resolve this module to this stub via the alias in their configs.
 *
 * The stub exports a real (but inert) Plate plugin:
 *   - YjsPlugin.configure({ options: { ydoc } }) works and returns a valid plugin.
 *   - No Yjs binding is established — the editor runs in single-user mode.
 *   - Seeding from stored Markdown, persistence, and the toolbar all work normally.
 *   - Real-time multi-user sync is restored once the package is installed.
 *
 * TO REMOVE THIS STUB:
 *   1. Run:  ./dev npm install
 *   2. Delete this file.
 *   3. Remove the '@platejs/yjs/react' alias from vite.config.ts AND vitest.config.ts.
 */
import { createSlatePlugin } from 'platejs'

export const YjsPlugin = createSlatePlugin({
  key: 'yjs',
})
