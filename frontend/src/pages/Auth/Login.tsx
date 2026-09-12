import { Head } from '@inertiajs/react'
import type { LoginPageProps } from '@/types'

/**
 * Google is the only identity provider, so this page has no fields — just a button that
 * hands off to OAuth.
 */
export default function Login({ googleAuthPath, error }: LoginPageProps) {
  // Read at render time from the layout's meta tag.
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Head title="Sign in" />

      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-center text-xl font-semibold text-slate-900">Sign in to Sourcebox</h1>
          <p className="mt-2 text-center text-sm text-slate-500">Continue with your Google account.</p>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {/*
            A real <form method="post">, not a button with an onClick handler, and not an
            Inertia <Link>. Three separate constraints force this:

            1. OmniAuth 2.x removed GET from the request phase to close CVE-2015-9284
               (login CSRF), so this must be a POST. A plain link would 404.
            2. The POST must carry Rails' authenticity token, which
               omniauth-rails_csrf_protection verifies.
            3. It must be a full-page navigation. OAuth redirects to Google, off our
               origin, and an XHR cannot follow that — Inertia would receive an opaque
               CORS failure instead of a redirect.

            This is also why the form has no onSubmit handler: the browser's native
            submission is exactly the behaviour we want.
          */}
          <form action={googleAuthPath} method="post" className="mt-6">
            <input type="hidden" name="authenticity_token" value={csrfToken} />

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.64h6.19a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.17-2 3.45-4.95 3.45-8.57Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.11 0 5.72-1.03 7.61-2.79l-3.72-2.88c-1.03.69-2.35 1.1-3.89 1.1-3 0-5.54-2.02-6.44-4.74H1.72v2.99A11.99 11.99 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.56 14.69a7.19 7.19 0 0 1 0-5.38V6.32H1.72a11.99 11.99 0 0 0 0 11.36l3.84-2.99Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.77c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.71 1.18 15.1 0 12 0 7.48 0 3.57 2.6 1.72 6.32l3.84 2.99C6.46 6.79 9 4.77 12 4.77Z"
                />
              </svg>
              Continue with Google
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          By continuing you agree to the terms of service.
        </p>
      </div>
    </div>
  )
}
