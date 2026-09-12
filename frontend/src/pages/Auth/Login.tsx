import { Head } from '@inertiajs/react'
import type { LoginPageProps } from '@/types'

/**
 * Google is the only identity provider, so this page has no fields — just a button that
 * hands off to OAuth.
 */
export default function Login({ googleAuthPath, allowPasswordSignIn, error }: LoginPageProps) {
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

          {/*
            Development-only email/password form.

            Rendered only when the server says so, never on the strength of a client-side
            environment check: `import.meta.env.DEV` is a build-time flag, so a production
            build made with the wrong NODE_ENV would ship a live password form. The server
            is the only thing that actually knows which environment it is running in.
          */}
          {allowPasswordSignIn && (
            <>
              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Dev only
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Posts to Devise's session route as a normal form. Devise redirects on
                  both success and failure, which Inertia follows as a visit. */}
              <form action="/users/sign_in" method="post" className="space-y-3">
                <input type="hidden" name="authenticity_token" value={csrfToken} />

                <div>
                  <label htmlFor="email" className="block text-xs font-medium text-slate-600">
                    Email
                  </label>
                  <input
                    id="email"
                    name="user[email]"
                    type="email"
                    autoComplete="username"
                    required
                    defaultValue="ada@sourcebox.dev"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-medium text-slate-600">
                    Password
                  </label>
                  <input
                    id="password"
                    name="user[password]"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  Sign in
                </button>

                <p className="text-center text-xs text-slate-400">
                  Seeded accounts use the password from <code>db/seeds.rb</code>.
                </p>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          By continuing you agree to the terms of service.
        </p>
      </div>
    </div>
  )
}
