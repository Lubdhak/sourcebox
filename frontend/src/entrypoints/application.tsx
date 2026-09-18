import { createInertiaApp, router } from '@inertiajs/react'
import type { ResolvedComponent } from '@inertiajs/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { writeCsrfToken } from '@/lib/csrf'
import { logger, reportNavigationTiming } from '@/lib/logger'
import '@/styles/application.css'

// Apply the user's explicit choice before React mounts, avoiding a light flash on a
// dark page. The Sourcebox cube in the navigation rail updates this value.
const savedTheme = window.localStorage.getItem('sourcebox:theme')
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.classList.toggle('dark', savedTheme === 'dark')
}

/**
 * Frontend entrypoint.
 *
 * Inertia v3 mounts the app itself — there is no manual createRoot call and no
 * ReactDOM import. It finds the `data-page` element Rails rendered, resolves the named
 * component, and hydrates.
 */

// Eager glob rather than a dynamic import.
//
// Eager bundles every page into the initial payload, which for an application this size
// is faster overall: page transitions are instant with no loading state, and the whole
// bundle is one cached, hashed file. Switching to `{ eager: false }` gives per-page code
// splitting, which is the right trade once there are enough pages that most users never
// visit most of them.
const pages = import.meta.glob<{ default: ResolvedComponent }>('../pages/**/*.tsx', { eager: true })

if (import.meta.hot) {
  import.meta.hot.accept()
}

router.on('navigate', (event) => {
  const token = event.detail.page.props.csrfToken
  if (typeof token === 'string' && token !== '') writeCsrfToken(token)
})

void createInertiaApp({
  // Surfaces double-rendering bugs and deprecated lifecycles during development. React
  // strips the double-invocation in production builds, so this costs nothing live.
  strictMode: true,

  resolve: (name) => {
    const page = pages[`../pages/${name}.tsx`]

    // Rails names the component as a string, so a typo or a moved file is otherwise a
    // silent blank screen. Failing loudly here names the missing component.
    if (!page) {
      throw new Error(
        `Inertia page "${name}" not found. Expected src/pages/${name}.tsx. ` +
          `Known pages: ${Object.keys(pages).join(', ')}`,
      )
    }

    return page
  },

  // v3's hook for wrapping the whole app. Preferred over mutating each page's `layout`
  // property, and over passing `setup` (which would mean taking over mounting entirely).
  // One boundary here catches render errors from every page.
  withApp: (app) => <ErrorBoundary>{app}</ErrorBoundary>,

  // Rails already streams JSON logs; this gives the browser half of the same picture.
  progress: {
    // Matches --color-brand-500. Shown only after 250ms so fast visits do not flash a bar.
    color: '#3b6fd4',
    delay: 250,
  },
})
  .then(() => {
    reportNavigationTiming()
  })
  .catch((error: unknown) => {
    // A failure here means the app never mounted, so the ErrorBoundary cannot help and the
    // user is looking at a blank page. Worth its own log event.
    logger.error('frontend.mount_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  })
