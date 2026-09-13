import { Head, usePage } from '@inertiajs/react'
import { AnalogClock } from '@/components/AnalogClock'
import { LogoCarousel } from '@/components/LogoCarousel'
import { readCsrfToken } from '@/lib/csrf'
import type { InertiaSharedProps, LoginPageProps } from '@/types'

/**
 * Google is the only identity provider, so this page has no fields — just a button that
 * hands off to OAuth. Development also renders an email/password form so a fresh checkout
 * can sign in without Google credentials.
 *
 * Visual language follows BetterCloud Track's login: split teal brand panel + white
 * form, Lato-adjacent sans, teal primary, outlined Google button.
 */
export default function Login({ googleAuthPath, allowPasswordSignIn, error }: LoginPageProps) {
  const { csrfToken: sharedToken } = usePage<InertiaSharedProps>().props
  const csrfToken = typeof sharedToken === 'string' && sharedToken !== '' ? sharedToken : readCsrfToken()

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <Head title="Sign in" />

      <aside className="relative flex flex-col overflow-hidden bg-[#006676] px-0 pt-8 text-white md:pt-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #80bec7 0, transparent 42%), radial-gradient(circle at 85% 80%, #014e5b 0, transparent 50%)',
          }}
        />

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
          <p className="mb-8 text-xs font-bold uppercase tracking-[0.28em] text-white/80">Sourcebox</p>
          <AnalogClock className="w-[min(100%,18rem)] sm:w-[22rem] md:w-[24rem] lg:w-[28rem]" />
          <p className="mt-8 max-w-xs text-center text-sm font-light leading-relaxed text-white/75">
            Visualize the work. Sign in to pick up where you left off.
          </p>
        </div>

        <div className="relative z-10 mb-10 w-full">
          <LogoCarousel />
        </div>
      </aside>

      <main className="flex items-center justify-center bg-[#f5f5f6] px-4 py-12 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="rounded-sm bg-white px-8 py-10 shadow-[0_8px_32px_rgba(32,35,42,0.08)] sm:px-10">
            <h1 className="text-[1.65rem] font-normal text-[#20232a]">Log in</h1>
            <p className="mt-1 text-sm text-[#7a7d84]">Sign in to Sourcebox</p>

            {error && (
              <div
                role="alert"
                className="mt-6 rounded-sm border border-[#f43e36]/30 bg-[#feeceb] px-3 py-2 text-sm text-[#f43e36]"
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
            <form action={googleAuthPath} method="post" className="mt-8">
              <input type="hidden" name="authenticity_token" value={csrfToken} />

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 border-[1.5px] border-[#cbcdd1] bg-white px-4 py-2.5 text-sm font-medium text-[#20232a] transition hover:border-[#006676] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006676]"
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
                Sign in with Google
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
                <div className="my-7 flex items-center gap-3">
                  <span className="h-px flex-1 bg-[#eaebec]" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#989ba2]">
                    Dev only
                  </span>
                  <span className="h-px flex-1 bg-[#eaebec]" />
                </div>

                {/* Posts to Devise's session route as a normal form. Devise redirects on
                    both success and failure, which Inertia follows as a visit. */}
                <form action="/users/sign_in" method="post" className="space-y-4">
                  <input type="hidden" name="authenticity_token" value={csrfToken} />

                  <div>
                    <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wide text-[#7a7d84]">
                      Email
                    </label>
                    <input
                      id="email"
                      name="user[email]"
                      type="email"
                      autoComplete="username"
                      required
                      defaultValue="ada@sourcebox.dev"
                      className="mt-1.5 w-full border-0 border-b border-[#d6d7da] bg-transparent px-0 py-2 text-sm text-[#20232a] transition focus:border-[#006676] focus:outline-none focus:ring-0"
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wide text-[#7a7d84]">
                      Password
                    </label>
                    <input
                      id="password"
                      name="user[password]"
                      type="password"
                      autoComplete="current-password"
                      required
                      className="mt-1.5 w-full border-0 border-b border-[#d6d7da] bg-transparent px-0 py-2 text-sm text-[#20232a] transition focus:border-[#006676] focus:outline-none focus:ring-0"
                    />
                  </div>

                  <button
                    type="submit"
                    className="mt-2 w-full bg-[#006676] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#014e5b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006676] focus-visible:ring-offset-2"
                  >
                    Log in
                  </button>

                  <p className="text-center text-xs text-[#989ba2]">
                    Seeded accounts use the password from <code>db/seeds.rb</code>.
                  </p>
                </form>
              </>
            )}
          </div>

          <p className="mt-8 text-center text-xs text-[#989ba2]">
            By continuing you agree to the terms of service.
          </p>
        </div>
      </main>
    </div>
  )
}
