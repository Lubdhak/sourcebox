# Sourcebox — From Zero to Running

Complete bootstrap and run runbook for the Rails 8.1 + GraphQL + Inertia v3 + React 19 stack
described in [`task.md`](./task.md).

This document takes a machine with **nothing installed** and ends with a running application,
a working Google login, a GraphQL endpoint answering queries, and a Solid Queue worker draining jobs.

Every version and command below was verified against the live package registries and gem sources
on **2026-09-13**. Where `task.md` specifies a command that no longer exists in the current release
of a dependency, the corrected command is used and the discrepancy is called out in
[Appendix A](#appendix-a--deviations-from-taskmd).

---

## Table of contents

1. [Step 0 — Machine state check](#step-0--machine-state-check)
2. [Verified version matrix](#verified-version-matrix)
3. [Choose your path](#choose-your-path)
4. [Phase 1 — Scaffold the Rails application](#phase-1--scaffold-the-rails-application)
5. [Phase 2 — Add the backend gems](#phase-2--add-the-backend-gems)
6. [Phase 3 — Vite Ruby + frontend dependencies](#phase-3--vite-ruby--frontend-dependencies)
7. [Phase 4 — Tailwind CSS v4](#phase-4--tailwind-css-v4)
8. [Phase 5 — Devise + Google OAuth](#phase-5--devise--google-oauth)
9. [Phase 6 — GraphQL](#phase-6--graphql)
10. [Phase 7 — Solid Queue](#phase-7--solid-queue)
11. [Phase 8 — Database creation and migration](#phase-8--database-creation-and-migration)
12. [Phase 9 — Environment configuration](#phase-9--environment-configuration)
13. [Phase 10 — Google Cloud OAuth credentials](#phase-10--google-cloud-oauth-credentials)
14. [Phase 11 — Run it (Docker Compose)](#phase-11--run-it-docker-compose)
15. [Phase 12 — Run it (local, no Docker)](#phase-12--run-it-local-no-docker)
16. [Phase 13 — Verify the installation](#phase-13--verify-the-installation)
17. [Phase 14 — Production build and deploy](#phase-14--production-build-and-deploy)
18. [Everyday commands](#everyday-commands)
19. [Troubleshooting](#troubleshooting)
20. [Appendix A — Deviations from task.md](#appendix-a--deviations-from-taskmd)

---

## Step 0 — Machine state check

Run this first. It tells you which path you need.

```bash
ruby -v; rails -v; node -v; npm -v; psql --version; docker -v; docker compose version
```

On the machine this runbook was written for, the result was:

| Tool | Found | Needed | Verdict |
|---|---|---|---|
| Ruby | 2.6.10 (macOS system Ruby) | >= 3.2 | Too old |
| Rails | not installed | 8.1.3.1 | Missing |
| Node | not installed | >= 22.12 | Missing |
| npm | not installed | >= 10 | Missing |
| PostgreSQL client | not installed | 18 | Missing |
| Docker | 29.6.1 | >= 24 | OK |
| Docker Compose | v5.2.0 | v2+ | OK |

**Do not use macOS system Ruby (2.6).** Rails 8.1 requires Ruby >= 3.2, and `gem install rails`
against system Ruby will fail on SIP-protected directories.

Because Docker was the only usable toolchain here, **Path A (Docker) is the recommended route** —
it needs no local Ruby, Node, or PostgreSQL at all.

### Start the Docker daemon

Installing Docker Desktop is not the same as running it. If you see
`Cannot connect to the Docker daemon at unix:///...docker.sock`, start it:

```bash
# macOS
open -a Docker

# Wait for the daemon to accept connections (takes 20-60s on a cold start)
until docker info >/dev/null 2>&1; do sleep 2; done && echo "Docker ready"
```

On Linux: `sudo systemctl start docker`.

---

## Verified version matrix

Pin these. They are mutually compatible and were confirmed against rubygems.org and
registry.npmjs.org on 2026-09-13.

### Ruby side

| Gem | Version | Notes |
|---|---|---|
| ruby | 3.4.x | Rails 8.1 needs >= 3.2. Ruby 3.4 is the safe choice for native gem support. |
| rails | 8.1.3.1 | |
| pg | 1.6.3 | |
| puma | 8.0.2 | |
| graphql | 2.6.10 | Class-based API, `GraphQL::Dataloader`, `trace_with`. |
| inertia_rails | 3.22.0 | Inertia protocol v3. |
| vite_rails | 3.11.1 | |
| devise | 5.0.4 | **Major version.** See [Phase 5](#phase-5--devise--google-oauth) for breaking changes. |
| omniauth | 2.1.4 | |
| omniauth-google-oauth2 | 1.2.3 | |
| omniauth-rails_csrf_protection | 2.0.1 | **Required.** OmniAuth 2 needs a POST request phase. |
| solid_queue | 1.7.0 | **No engine migrations any more.** See [Phase 7](#phase-7--solid-queue). |

### Node side

| Package | Version | Notes |
|---|---|---|
| node | 24.x | Vite 8 requires `^20.19.0 \|\| >=22.12.0`. |
| react / react-dom | 19.3.0 | |
| @inertiajs/react | 3.7.1 | Peer-depends on React `^19.0.0`. |
| @inertiajs/core | 3.7.1 | Dev dependency, needed so TS sees adapter types. |
| vite | 8.3.0 | Rolldown-based. |
| @vitejs/plugin-react | 6.1.1 | Requires Vite `^8.0.0`. |
| vite-plugin-ruby | 5.2.3 | Peer `vite >=5.0.0`, so Vite 8 is fine. |
| tailwindcss | 4.3.3 | **v4 — no `tailwind.config.js`, no PostCSS step.** |
| @tailwindcss/vite | 4.3.3 | Peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8`. |
| typescript | 7.0.2 | |

### Infrastructure

| Component | Version |
|---|---|
| PostgreSQL | 18 |

### Compatibility constraints worth knowing before you start

- **No Axios anywhere.** `@inertiajs/core@3.7.1` runtime dependencies are only
  `@jridgewell/trace-mapping`, `es-toolkit`, and `laravel-precognition`. Axios is a *dev* dependency
  of the package and ships no longer in your bundle. Inertia v3 defaults to its own XHR client.
  Do not add Axios back.
- **`@vitejs/plugin-react@6` optional peers.** It declares `oxc-transform-react`,
  `@rolldown/plugin-babel`, and `babel-plugin-react-compiler` as peers, but all three are marked
  `optional: true`. You do **not** need to install them; ignore npm's peer warnings unless you
  want the React Compiler.
- **Tailwind v4 is a rewrite.** There is no `npx tailwindcss init`, no `tailwind.config.js`, and no
  `postcss.config.js`. Configuration is CSS-first via `@import "tailwindcss"` plus `@theme`.
  Any tutorial telling you to create `tailwind.config.js` is describing v3.
- **Vite must exclusively own `app/frontend`.** We scaffold with `--skip-asset-pipeline` and
  `--skip-javascript` so Propshaft and Importmaps are never installed and cannot fight Vite.

---

## Choose your path

| | Path A — Docker | Path B — Local native |
|---|---|---|
| Local Ruby/Node/PostgreSQL needed | No | Yes |
| Matches production | Yes | Approximately |
| Best for | Everyone, especially this machine | Contributors who already run rbenv/asdf + PG |

Path A uses throwaway containers for the generator steps, then Docker Compose to run.
Both paths converge at [Phase 8](#phase-8--database-creation-and-migration).

### Path A setup — build the toolchain image once

Several generator steps need Ruby and Node **in the same process** (`vite install` shells out to
`npm add`). Build one image that has both. This takes a couple of minutes once, then every
subsequent command is instant.

```bash
cd /Users/lmahap/Codebase/sourcebox

cat > /tmp/toolchain.Dockerfile <<'EOF'
FROM node:24-slim AS node
FROM ruby:3.4-slim-trixie
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      build-essential git libpq-dev libyaml-dev pkg-config curl postgresql-client \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
EOF

docker build -t sourcebox-toolchain -f /tmp/toolchain.Dockerfile /tmp
```

Then define the helpers used throughout this runbook. Run this once per terminal session:

```bash
# Combined Ruby + Node toolchain — use for anything that spans both
tc() { docker run --rm -it -v "$PWD":/app -w /app \
         -e BUNDLE_PATH=/app/vendor/bundle sourcebox-toolchain bash -lc "$*"; }

# Aliases so each step reads clearly
rb() { tc "$*"; }   # Ruby / Rails / bundle
nd() { tc "$*"; }   # npm
```

Verify the toolchain before continuing:

```bash
tc 'ruby -v && node -v && npm -v && pg_isready --version'
```

> Ownership note: on Docker Desktop for macOS, files the container creates appear on the host owned
> by your user, so no `chown` cleanup is needed. On native Linux, add `--user "$(id -u):$(id -g)"`
> to the `docker run` line or generated files will be root-owned.

---

## Phase 1 — Scaffold the Rails application

### 1.1 Install Rails and generate the app

```bash
rb 'gem install rails -v 8.1.3.1 --no-document &&
    rails new . \
      --database=postgresql \
      --skip-asset-pipeline \
      --skip-javascript \
      --skip-hotwire \
      --skip-jbuilder \
      --skip-action-mailbox \
      --skip-action-text \
      --skip-active-storage \
      --skip-action-cable \
      --skip-solid \
      --skip-kamal \
      --skip-docker \
      --skip-ci \
      --skip-system-test \
      --force'
```

Path B equivalent (no container prefix):

```bash
gem install rails -v 8.1.3.1
rails new . --database=postgresql --skip-asset-pipeline --skip-javascript \
  --skip-hotwire --skip-jbuilder --skip-action-mailbox --skip-action-text \
  --skip-active-storage --skip-action-cable --skip-solid --skip-kamal \
  --skip-docker --skip-ci --skip-system-test --force
```

### 1.2 Why each flag

| Flag | Reason |
|---|---|
| `--database=postgresql` | PostgreSQL 18, JSONB. |
| `--skip-asset-pipeline` | Keeps Propshaft out. Vite owns all assets. |
| `--skip-javascript` | Keeps Importmap out. Prevents an `app/javascript` that competes with `app/frontend`. |
| `--skip-hotwire` | Turbo/Stimulus conflict with Inertia's client-side router. |
| `--skip-jbuilder` | We render Inertia pages and GraphQL, never REST JSON views. |
| `--skip-active-storage`, `--skip-action-text`, `--skip-action-mailbox` | Avatar is a remote URL string; no uploads or rich text needed. |
| `--skip-action-cable` | No WebSockets yet. Add Solid Cable later if you need them — still zero Redis. |
| `--skip-solid` | We install Solid Queue deliberately and skip Solid Cache/Cable. |
| `--skip-kamal`, `--skip-docker` | We write our own multi-stage `Dockerfile` and Compose file. |
| `--skip-ci` | Add your own pipeline. |
| `--skip-system-test` | Avoids pulling Selenium/Chrome into the image. Minitest is kept. |
| `--force` | `task.md` already exists in the directory. |

`rails new` overwrites `README.md`. Keep this file (`SETUP.md`) as the runbook and rewrite
`README.md` with the architecture documentation afterwards.

### 1.3 Verify

```bash
rb 'ruby -v && bin/rails -v'
# => ruby 3.4.x
# => Rails 8.1.3.1

# These directories must NOT exist:
ls app/assets app/javascript 2>&1 | grep -q 'No such file' && echo "OK: no Propshaft/Importmap"
```

---

## Phase 2 — Add the backend gems

Order matters only in that `bundle add` runs `bundle install` each time. Adding them in one call is
faster:

```bash
rb 'bundle add graphql --version "~> 2.6" \
      && bundle add inertia_rails --version "~> 3.22" \
      && bundle add vite_rails --version "~> 3.11" \
      && bundle add devise --version "~> 5.0" \
      && bundle add omniauth-google-oauth2 --version "~> 1.2" \
      && bundle add omniauth-rails_csrf_protection --version "~> 2.0" \
      && bundle add solid_queue --version "~> 1.7"'
```

### Why `omniauth-rails_csrf_protection` is not optional

OmniAuth 2.x removed GET from the default request phase to close
[CVE-2015-9284](https://github.com/omniauth/omniauth/wiki/Resolving-CVE-2015-9284) (a login CSRF).
The request phase must be a **POST carrying a valid authenticity token**. This gem supplies that
verification. Without it, Devise's OmniAuth route either 404s with
`Not found. Authentication passthru.` or is left insecure.

This has a direct consequence for the login button — see [Phase 5.4](#54-the-login-button-must-be-a-real-form-post).

### Verify

```bash
rb 'bundle list | grep -E "graphql|inertia|vite|devise|omniauth|solid_queue"'
```

Commit `Gemfile.lock`. It is what makes the Docker build reproducible.

---

## Phase 3 — Vite Ruby + frontend dependencies

### 3.1 Install Vite Ruby

> This step shells out to `npm add -D`, so it needs **Ruby and Node in the same container**. Use the
> combined `sourcebox-toolchain` image from [Choose your path](#choose-your-path):
>
> ```bash
> tc 'bundle exec vite install'
> ```
>
> If you run it in a Ruby-only container it still succeeds — the npm step is wrapped in a
> non-fatal capture, so the config files are created and only the package install is skipped. Phase
> 3.2 installs the packages explicitly anyway.

Verified against `vite_ruby`'s `CLI::Install`, this creates:

| Path | Purpose |
|---|---|
| `bin/vite` | Binstub for `bin/vite dev` / `bin/vite build` |
| `config/vite.json` | Ruby-side config (ports, build output, `sourceCodeDir`) |
| `vite.config.ts` | The Vite config |
| `app/frontend/entrypoints/application.js` | Sample entrypoint — delete it, we use `application.tsx` |
| `Procfile.dev` | Appends the line `vite: bin/vite dev` |
| `package.json` | Created with `"type": "module"` if absent |
| `.gitignore` | Appends `/public/vite*`, `node_modules`, `*.local` |

Two behaviours worth knowing:

- It installs `vite@^8.0.0` and `vite-plugin-ruby@^5.2.0` (its pinned defaults), which already match
  the version matrix above — so there is no version drift to undo.
- If `package.json` exists **without** `"type": "module"`, it renames `vite.config.ts` to
  `vite.config.mts`. Keep `"type": "module"` so you get the plain `.ts` filename this runbook
  assumes.

### 3.2 Install the npm packages

```bash
nd 'npm install react@^19.3.0 react-dom@^19.3.0 @inertiajs/react@^3.7.1'

nd 'npm install -D \
      vite@^8.3.0 \
      @vitejs/plugin-react@^6.1.1 \
      vite-plugin-ruby@^5.2.3 \
      typescript@^7.0.2 \
      @types/react@^19.2.0 \
      @types/react-dom@^19.2.0 \
      @inertiajs/core@^3.7.1'
```

`@inertiajs/core` is listed as a **dev** dependency on purpose: it is already a transitive runtime
dependency of `@inertiajs/react`, but declaring it directly is what makes the adapter's types
resolvable when you augment them in `globals.d.ts` (this is what `inertia_rails`' own TypeScript
generator does).

### 3.3 Remove the JS entrypoint stub

```bash
rm -f app/frontend/entrypoints/application.js
```

Then create the real entrypoint and supporting files (full contents belong in the project source,
per `task.md` §43):

```text
app/frontend/
├── entrypoints/
│   └── application.tsx
├── Pages/
│   ├── Auth/Login.tsx
│   └── Dashboard/Show.tsx
├── components/
│   └── ErrorBoundary.tsx
├── lib/
│   ├── graphql.ts
│   └── logger.ts
├── types/
│   └── index.ts
└── styles/
    └── application.css
```

### 3.4 `config/vite.json`

Set the source directory and dev-server binding so the container is reachable from the host:

```json
{
  "all": {
    "sourceCodeDir": "app/frontend",
    "watchAdditionalPaths": []
  },
  "development": {
    "autoBuild": true,
    "publicOutputDir": "vite-dev",
    "host": "0.0.0.0",
    "port": 3036
  },
  "test": {
    "autoBuild": true,
    "publicOutputDir": "vite-test",
    "port": 3037
  },
  "production": {
    "autoBuild": false,
    "publicOutputDir": "vite"
  }
}
```

`"host": "0.0.0.0"` is required inside Docker — the default `localhost` binding is not reachable
from your browser.

### 3.5 `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [RubyPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'app/frontend'),
    },
  },
  server: {
    // Required for HMR to reach the browser from inside a container.
    hmr: { host: 'localhost' },
  },
})
```

### 3.6 `tsconfig.json`

Strict mode is mandatory per `task.md` §23.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["app/frontend/*"] }
  },
  "include": ["app/frontend/**/*.ts", "app/frontend/**/*.tsx", "vite.config.ts"]
}
```

### 3.7 npm scripts

Add to `package.json` so type errors fail the build rather than reaching production:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "vite build"
  }
}
```

### 3.8 Inertia v3 API notes

Most Inertia examples online are v2. These are the v3.7.1 APIs, verified from the package's shipped
type definitions and official guidelines. Getting them wrong produces runtime errors that look like
build problems.

**Renamed / removed in v3:**

| v2 | v3.7.1 |
|---|---|
| `router.cancel()` | `router.cancelAll()` |
| `router.on('invalid', …)` | `router.on('httpException', …)` |
| `router.on('exception', …)` | `router.on('networkError', …)` |
| Axios-based HTTP internals | Pluggable client, XHR by default (`http.setClient`) |

**`createInertiaApp` no longer needs a manual `setup`.** The React adapter mounts with `createRoot`
itself and accepts `strictMode` directly, so `application.tsx` can be:

```tsx
import { createInertiaApp } from '@inertiajs/react'

void createInertiaApp({
  strictMode: true,
  resolve: (name) => {
    const pages = import.meta.glob('../Pages/**/*.tsx', { eager: true })
    return pages[`../Pages/${name}.tsx`] as never
  },
})
```

**Navigation timing** (`task.md` §17, §35). `router.on` returns an unsubscribe function; the `start`
event carries a `PendingVisit` and `finish` carries an `ActiveVisit`, both exposing `url`:

```ts
import { router } from '@inertiajs/react'

let startedAt = 0
router.on('start', (event) => { startedAt = performance.now() })
router.on('finish', (event) => {
  logger.info('inertia.navigation', {
    url: event.detail.visit.url.toString(),
    duration_ms: Math.round(performance.now() - startedAt),
    status: event.detail.visit.completed ? 'success'
          : event.detail.visit.cancelled ? 'cancelled' : 'interrupted',
  })
})
```

Never log `event.detail.page.props` — page props contain user data (`task.md` §35).

**`useHttp` is a form-shaped hook, not a fetch wrapper.** Its signature is
`useHttp(method, url, data)` (or just `useHttp(data)`), and it returns
`{ data, setData, submit, get, post, put, patch, delete, processing, errors, response, cancel, optimistic, … }`.
Each verb returns a `Promise<TResponse>`. It also has **built-in optimistic support**:

```ts
const form = useHttp('patch', '/dashboards/1/preferences', { theme: 'dark' })
await form.optimistic((current) => ({ theme: current.theme })).submit()
```

`router.optimistic(...)` does the same for page-prop visits, with automatic rollback on failure.

**When to use `useHttp` vs the GraphQL client** (`task.md` §2, §22) — the short version, expanded in
`README.md`:

- **`useHttp`** — talks to *your Rails controllers*, participates in Inertia's request lifecycle
  (CSRF, error bags, `processing`, progress, interceptors), and is the right tool for
  server-owned side effects that are not part of client state: sign-out, a webhook retry, a
  one-off form POST.
- **`lib/graphql.ts`** — talks to `POST /graphql` for all *client-state* reads and writes:
  dashboard queries, mutations, filtering, pagination, optimistic state. It returns typed data your
  React state owns, and never replaces page props.

The dividing line: if the server should decide what the page *is*, use Inertia. If the client owns
the state and just needs data, use GraphQL.

### Verify

```bash
nd 'npm run typecheck'   # passes once the frontend files exist
```

---

## Phase 4 — Tailwind CSS v4

Tailwind v4 needs **no config file and no PostCSS**. It is already installed as a Vite plugin
(Phase 3.5). Only two steps remain.

### 4.1 Install

```bash
nd 'npm install -D tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3'
```

### 4.2 CSS entrypoint — `app/frontend/styles/application.css`

```css
@import "tailwindcss";

@theme {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

Import it once from the JS entrypoint so Vite includes it in the graph:

```ts
// app/frontend/entrypoints/application.tsx
import '../styles/application.css'
```

> **Do not** create `tailwind.config.js` or `postcss.config.js`. In v4 they are ignored at best and
> misleading at worst. Content detection is automatic; theme customisation lives in `@theme`.

---

## Phase 5 — Devise + Google OAuth

### 5.1 Generators

```bash
rb 'bin/rails generate devise:install && bin/rails generate devise User'
```

### 5.2 Devise 5 breaking changes that will bite you

`task.md` predates Devise 5. These are the changes that matter here:

1. **`Devise.secret_key` now always derives from `application.secret_key_base`.** The old
   `SecretKeyFinder` lookup chain (credentials → secrets → config) is gone. If `SECRET_KEY_BASE`
   changes between deploys, every previously issued confirmation/reset/unlock token is invalidated.
   Treat `SECRET_KEY_BASE` as a long-lived secret, not a per-deploy value.
2. **`:unprocessable_entity` is deprecated by Rack 3.1+.** In `config/initializers/devise.rb` use:
   ```ruby
   config.responder.error_status = :unprocessable_content
   ```
3. Removed APIs: the `:bypass` option on `sign_in` (use `bypass_sign_in`),
   `devise_error_messages!`, the positional scope argument in the `sign_in` test helper, and
   `Devise::TestHelpers` (use `Devise::Test::ControllerHelpers`).
4. Routes are lazy-loaded in dev/test now, so Devise resolves `Devise.mappings` later. If you read
   `Devise.mappings` from an initializer, move it into `config.to_prepare`.

### 5.3 Model and routes

`app/models/user.rb` needs the OmniAuth module and the provider registered:

```ruby
devise :database_authenticatable, :registerable, :recoverable,
       :rememberable, :validatable, :trackable,
       :omniauthable, omniauth_providers: [:google_oauth2]
```

`config/routes.rb`:

```ruby
devise_for :users, controllers: { omniauth_callbacks: "users/omniauth_callbacks" }
```

This generates the request-phase route at **`/users/auth/google_oauth2`** and the callback at
`/users/auth/google_oauth2/callback`.

> **Path correction:** `task.md` §14 writes `/users/auth/google`. The actual path is
> `/users/auth/google_oauth2`, because Devise derives it from the OmniAuth strategy name
> registered by `omniauth-google-oauth2`. Use the route helper
> `user_google_oauth2_omniauth_authorize_path` rather than hardcoding the string.

### 5.4 The login button must be a real form POST

Two independent constraints meet here:

- **Inertia constraint** (`task.md` §14): the OAuth redirect goes to an external origin, so it must
  not happen inside an Inertia XHR visit. It needs a full-page browser navigation.
- **OmniAuth 2 constraint** (Phase 2): the request phase must be a POST with a CSRF token.

`window.location = "..."` satisfies the first but **fails the second** — it issues a GET. The single
construct that satisfies both is a plain HTML form doing a native (non-Inertia) submit:

```tsx
// app/frontend/Pages/Auth/Login.tsx  (excerpt)
const csrfToken =
  document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

<form method="post" action="/users/auth/google_oauth2" onSubmit={() => setLoading(true)}>
  <input type="hidden" name="authenticity_token" value={csrfToken} />
  <button type="submit" disabled={loading} aria-busy={loading}>
    {loading ? 'Redirecting to Google…' : 'Continue with Google'}
  </button>
</form>
```

A native `<form>` submit is a full-page navigation; Inertia does not intercept it (only `<Link>`,
Inertia's `<Form>`, and `router.*` are intercepted). So this breaks out of the XHR context exactly
as required.

This requires `<%= csrf_meta_tags %>` in `app/views/layouts/application.html.erb`.

> Do **not** "fix" this by setting `OmniAuth.config.allowed_request_methods = [:get]`. That
> reintroduces the login-CSRF vulnerability.

### 5.5 `config/initializers/omniauth.rb`

```ruby
Rails.application.config.middleware.use OmniAuth::Builder do
  provider :google_oauth2,
           ENV.fetch("GOOGLE_CLIENT_ID"),
           ENV.fetch("GOOGLE_CLIENT_SECRET"),
           scope: "email,profile",
           prompt: "select_account",
           image_aspect_ratio: "square",
           image_size: 200,
           access_type: "online"
end

OmniAuth.config.allowed_request_methods = [:post]
OmniAuth.config.silence_get_warning = true

# Never leak provider errors to the client; report them as structured events.
OmniAuth.config.on_failure = proc do |env|
  Users::OmniauthCallbacksController.action(:failure).call(env)
end
```

Note: Devise's `omniauth_providers` registration and this initializer are complementary — Devise
builds the routes, the initializer configures the middleware credentials.

### 5.6 Migration for the OAuth columns

Per `task.md` §15, `users` gains `provider`, `uid`, `avatar_url`, and a name. Generate it in
[Phase 8](#phase-8--database-creation-and-migration).

---

## Phase 6 — GraphQL

### 6.1 Install

The gem ships a generator, but it scaffolds `app/graphql/<app_name>_schema.rb` and a
`Types::` namespace that does not match the layout `task.md` §39 requires
(`app/graphql/schema.rb`, `app/graphql/loaders/`, `app/graphql/mutations/`). Run it and then
restructure, or skip it and write the tree by hand:

```bash
rb 'bin/rails generate graphql:install --skip-graphiql'
```

What you must end up with:

```text
app/graphql/
├── application_graphql.rb
├── schema.rb
├── types/
│   ├── base_object.rb
│   ├── base_input_object.rb
│   ├── base_enum.rb
│   ├── base_field.rb
│   ├── query_type.rb
│   ├── mutation_type.rb
│   ├── user_type.rb
│   ├── dashboard_type.rb
│   └── page_info_type.rb
├── mutations/
│   ├── base_mutation.rb
│   └── update_dashboard_state.rb
├── loaders/
│   ├── record_loader.rb
│   └── association_loader.rb
└── resolvers/
```

### 6.2 Route

A single endpoint, per `task.md` §3:

```ruby
# config/routes.rb
post "/graphql", to: "graphql#execute"
```

Do not mount GraphiQL as a Rails engine in production. If you want it in development only, guard it:

```ruby
if Rails.env.development?
  mount GraphiQL::Rails::Engine, at: "/graphiql", graphql_path: "/graphql"
end
```

### 6.3 Schema safeguards (graphql-ruby 2.6 API)

These are the current class-method names, verified in the 2.6.10 source. Put them in
`app/graphql/schema.rb`:

```ruby
class Schema < GraphQL::Schema
  query Types::QueryType
  mutation Types::MutationType

  use GraphQL::Dataloader

  # Query safeguards (task.md §6)
  max_depth 12
  max_complexity 300
  validate_max_errors 10

  # Pagination limits (task.md §6)
  default_page_size 25
  default_max_page_size 100

  # Production introspection policy (task.md §6)
  disable_introspection_entry_points if Rails.env.production?

  # Structured observability (task.md §31)
  trace_with GraphqlTracing::EventTrace

  rescue_from(ActiveRecord::RecordNotFound) do |_err, _obj, _args, _ctx, field|
    raise GraphQL::ExecutionError.new("#{field.type.unwrap.graphql_name} not found",
                                      extensions: { code: "NOT_FOUND" })
  end

  def self.unauthorized_object(error)
    raise GraphQL::ExecutionError.new("Not authorized", extensions: { code: "FORBIDDEN" })
  end

  def self.unauthorized_field(error)
    raise GraphQL::ExecutionError.new("Not authorized", extensions: { code: "FORBIDDEN" })
  end

  # Never leak internals to clients (task.md §4, §31)
  def self.type_error(err, context)
    Rails.event.notify("graphql.error",
                       error_class: err.class.name,
                       request_id: context[:request_id])
    super
  end
end
```

Notes on the exact API:

- `max_depth` and `max_complexity` both accept `count_introspection_fields:` if you want
  introspection excluded from the budget.
- Pagination config is `default_page_size` / `default_max_page_size` (not `max_page_size`, which was
  the pre-2.0 name).
- `disable_introspection_entry_points` removes `__schema` and `__type` as *query entry points*.
- Instrumentation uses `trace_with SomeModule`, not the removed `instrument(...)` API. The trace
  module implements hooks such as `execute_query`, `execute_multiplex`, `validate`,
  `execute_field`, and `begin_dataloader` / `end_dataloader`.

### 6.4 Dataloader

graphql-ruby 2.6 ships `GraphQL::Dataloader::ActiveRecordSource` and
`ActiveRecordAssociationSource`, so you can batch with zero custom code:

```ruby
dataloader.with(GraphQL::Dataloader::ActiveRecordSource, User).load(object.user_id)
```

`task.md` §7 asks for a reusable loader under `app/graphql/loaders/`. Implement it as a
`GraphQL::Dataloader::Source` subclass — the contract is a single `fetch(keys)` returning results
positionally aligned with `keys`:

```ruby
# app/graphql/loaders/record_loader.rb
module Loaders
  class RecordLoader < GraphQL::Dataloader::Source
    def initialize(model, column: :id)
      @model = model
      @column = column
    end

    def fetch(keys)
      records = @model.where(@column => keys).index_by { |r| r.public_send(@column) }
      keys.map { |key| records[key] }   # must align with `keys`
    end
  end
end
```

Used from a type as `dataloader.with(Loaders::RecordLoader, User).load(object.user_id)`.

### 6.5 Authentication context

Reuse the Devise session — never build a second auth mechanism (`task.md` §4):

```ruby
# app/controllers/graphql_controller.rb
context = {
  current_user: current_user,          # Devise helper
  request_id:   request.request_id,
}
```

Because the browser sends the session cookie, `protect_from_forgery` applies. The GraphQL client
must send the CSRF token — see Phase 3's `graphql.ts` and Phase 13's smoke test.

---

## Phase 7 — Solid Queue

> **Important correction.** `task.md` §12 and §44 both say to run
> `rails solid_queue:install:migrations`. **That task does not exist in solid_queue 1.7.0.**
> Verified against the gem: `lib/solid_queue/tasks.rb` defines only `solid_queue:install`,
> `solid_queue:update`, `solid_queue:start`, and `solid_queue:check`, and the engine ships **no
> `db/migrate` directory** — so the generic `<engine>:install:migrations` Rails task has nothing to
> copy. Instead the installer emits a **schema file**, `db/queue_schema.rb`.

### 7.1 Run the installer

```bash
rb 'bin/rails generate solid_queue:install'
```

Verified to produce:

| File | Purpose |
|---|---|
| `config/queue.yml` | Dispatcher/worker configuration |
| `config/recurring.yml` | Cron-style recurring jobs |
| `db/queue_schema.rb` | The 10 `solid_queue_*` tables, as a schema (not a migration) |
| `bin/jobs` | Worker entrypoint (executable) |

It also rewrites `config/environments/production.rb` to:

```ruby
config.active_job.queue_adapter = :solid_queue
config.solid_queue.connects_to = { database: { writing: :queue } }
```

### 7.2 Choose your database topology

`task.md` §12 asks for both options to be explained, defaulting to the simplest safe one.

#### Option 1 (recommended default) — separate `queue` database, same PostgreSQL server

This is what the generator configures out of the box, and it needs no schema surgery. `db/queue_schema.rb`
is loaded automatically by `db:prepare` because Rails resolves the schema file for a non-primary
database config named `queue` to `db/queue_schema.rb`.

```yaml
# config/database.yml
default: &default
  adapter: postgresql
  encoding: unicode
  pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>
  host: <%= ENV.fetch("POSTGRES_HOST", "localhost") %>
  port: <%= ENV.fetch("POSTGRES_PORT", 5432) %>
  username: <%= ENV.fetch("POSTGRES_USER", "sourcebox") %>
  password: <%= ENV.fetch("POSTGRES_PASSWORD", "sourcebox") %>

development:
  primary:
    <<: *default
    database: <%= ENV.fetch("POSTGRES_DB", "sourcebox_development") %>
  queue:
    <<: *default
    database: <%= ENV.fetch("POSTGRES_DB", "sourcebox_development") %>_queue
    schema_dump: queue_schema.rb

production:
  primary:
    <<: *default
    database: <%= ENV.fetch("POSTGRES_DB", "sourcebox_production") %>
  queue:
    <<: *default
    database: <%= ENV.fetch("POSTGRES_DB", "sourcebox_production") %>_queue
    schema_dump: queue_schema.rb
```

Add the same `connects_to` line to `config/environments/development.rb` that the generator added to
production, so dev and prod behave identically:

```ruby
config.active_job.queue_adapter = :solid_queue
config.solid_queue.connects_to = { database: { writing: :queue } }
```

Why this is the safer default despite being two databases:

- Job churn is high-volume, short-lived write traffic. Keeping it out of the primary keeps your
  primary's autovacuum, WAL, and backup footprint predictable.
- You can truncate or restore the queue independently of business data.
- `db:migrate` on the primary never contends with worker polling locks.
- It is still **one PostgreSQL server, one connection string, zero Redis** — so it does not add
  operational surface.

#### Option 2 — single database

Simpler mental model, one `DATABASE_URL`, but you must convert the schema file into a real
migration yourself, since `solid_queue:install:migrations` no longer exists:

```bash
rb 'bin/rails generate migration CreateSolidQueueTables'
```

Then make the migration load the shipped schema:

```ruby
class CreateSolidQueueTables < ActiveRecord::Migration[8.1]
  def up
    # db/queue_schema.rb is an ActiveRecord::Schema definition, so evaluate it
    # against the primary connection instead of a separate `queue` database.
    load Rails.root.join("db/queue_schema.rb")
  end

  def down
    %w[
      solid_queue_blocked_executions solid_queue_claimed_executions
      solid_queue_failed_executions solid_queue_pauses solid_queue_processes
      solid_queue_ready_executions solid_queue_recurring_executions
      solid_queue_recurring_tasks solid_queue_scheduled_executions
      solid_queue_semaphores solid_queue_jobs
    ].each { |t| drop_table t, if_exists: true }
  end
end
```

and remove the `connects_to` line plus the `queue:` database entry.

> Caveat: `db/queue_schema.rb` declares `ActiveRecord::Schema[7.1].define(version: 1)`, which will
> stamp your primary schema version. Prefer Option 1 unless you have a hard single-database
> requirement.

### 7.3 `config/queue.yml` — production-ready

The generated template is a starting point. A production-shaped version:

```yaml
default: &default
  dispatchers:
    - polling_interval: 1
      batch_size: 500
      concurrency_maintenance_interval: 600
  workers:
    - queues: "critical"
      threads: 5
      processes: <%= ENV.fetch("JOB_CONCURRENCY_CRITICAL", 1) %>
      polling_interval: 0.5
    - queues: [default, analytics]
      threads: 3
      processes: <%= ENV.fetch("JOB_CONCURRENCY", 1) %>
      polling_interval: 1

development:
  <<: *default

test:
  <<: *default

production:
  <<: *default
```

`processes` scales vertically inside one container; run more `worker` containers to scale
horizontally.

### 7.4 Confirm zero Redis

```bash
rb 'bundle list | grep -ci redis'   # must print 0
nd 'npm ls redis ioredis 2>&1 | grep -c empty'
```

---

## Phase 8 — Database creation and migration

### 8.1 Application migrations

Generate in this order — ordering matters because the `dashboards` foreign key requires `users` to
exist first, and Devise's `users` table must exist before you add OAuth columns to it.

```bash
# 1. Devise already generated the users table migration in Phase 5.1.

# 2. OAuth columns on users (task.md §15)
rb 'bin/rails generate migration AddOmniauthToUsers \
      provider:string uid:string avatar_url:string name:string'

# 3. Dashboards with JSONB ui_state (task.md §15)
rb 'bin/rails generate migration CreateDashboards'
```

Edit the OAuth migration to add the constraints `task.md` §15 requires:

```ruby
class AddOmniauthToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :provider,   :string
    add_column :users, :uid,        :string
    add_column :users, :avatar_url, :string
    add_column :users, :name,       :string

    # One identity per provider. Partial index: rows created by password signup
    # have NULL provider/uid and must not collide with each other.
    add_index :users, [:provider, :uid],
              unique: true,
              where: "provider IS NOT NULL AND uid IS NOT NULL",
              name: "index_users_on_provider_and_uid"
  end
end
```

And the dashboards migration:

```ruby
class CreateDashboards < ActiveRecord::Migration[8.1]
  def change
    create_table :dashboards do |t|
      t.references :user, null: false, foreign_key: true, index: true
      t.jsonb :ui_state, null: false, default: {}
      t.timestamps
    end

    # Guard the JSONB shape at the database boundary (task.md §48).
    add_check_constraint :dashboards,
                         "jsonb_typeof(ui_state) = 'object'",
                         name: "dashboards_ui_state_is_object"
  end
end
```

#### On JSONB GIN indexes

Do **not** add a GIN index on `ui_state` yet. A GIN index is worth it only when you filter or search
*inside* the JSONB across many rows — `WHERE ui_state @> '{"theme":"dark"}'` or
`ui_state ? 'widgets'`. In this schema every read is `WHERE user_id = ? ` or by primary key, so the
`user_id` btree index answers every query and a GIN index would only add write amplification on
every dashboard save. Add `CREATE INDEX ... USING gin (ui_state jsonb_path_ops)` the day you start
querying by JSONB content, and prefer `jsonb_path_ops` if you only ever use containment (`@>`),
since it is smaller and faster than the default `jsonb_ops`.

### 8.2 Create and migrate

Bring PostgreSQL up first (Docker path):

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U sourcebox   # wait for "accepting connections"
```

Then:

```bash
docker compose run --rm web bin/rails db:prepare
```

`db:prepare` is preferable to `db:create && db:migrate` here because, with the multi-database
configuration from Phase 7.2, it creates **both** databases, runs migrations on `primary`, and
**loads `db/queue_schema.rb` into `queue`** — which plain `db:migrate` will not do.

If you insist on the explicit sequence from `task.md` §44:

```bash
docker compose run --rm web bin/rails db:create
docker compose run --rm web bin/rails db:migrate          # primary only
docker compose run --rm web bin/rails db:schema:load:queue # loads queue_schema.rb
```

### 8.3 Verify

```bash
docker compose exec postgres psql -U sourcebox -d sourcebox_development \
  -c '\d dashboards' -c 'select version from schema_migrations order by version;'

docker compose exec postgres psql -U sourcebox -d sourcebox_development_queue \
  -c '\dt solid_queue_*'
```

You should see the `jsonb` column with its check constraint, and 10 `solid_queue_*` tables in the
queue database.

---

## Phase 9 — Environment configuration

### 9.1 `.env.example`

Commit this. Never commit `.env`.

```dotenv
# --- Rails ---
RAILS_ENV=development
RAILS_LOG_LEVEL=debug
RAILS_MAX_THREADS=5
# Generate with: bin/rails secret
SECRET_KEY_BASE=

# --- PostgreSQL 18 ---
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=sourcebox_development
POSTGRES_USER=sourcebox
POSTGRES_PASSWORD=sourcebox
# Optional: overrides the discrete values above if your platform injects a URL
# DATABASE_URL=postgres://sourcebox:sourcebox@postgres:5432/sourcebox_development

# --- Google OAuth2 ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# --- Vite ---
VITE_RUBY_HOST=0.0.0.0
VITE_RUBY_PORT=3036

# --- Solid Queue ---
JOB_CONCURRENCY=1
JOB_CONCURRENCY_CRITICAL=1
```

### 9.2 Create your local `.env`

```bash
cp .env.example .env
rb 'bin/rails secret' | tail -1   # paste into SECRET_KEY_BASE
```

### 9.3 Make sure `.env` is ignored

```bash
grep -qxF '.env' .gitignore || printf '\n# Local secrets\n.env\n.env.*\n!.env.example\n' >> .gitignore
git check-ignore -v .env    # must print a matching rule
```

### 9.4 Production secrets — do not use `.env`

`.env` files are a development convenience. In production inject secrets as environment variables
from the platform's secret store so they never land in an image layer, a git object, or `docker inspect`:

| Platform | Mechanism |
|---|---|
| AWS ECS / Fargate | Task definition `secrets` referencing Secrets Manager or SSM Parameter Store ARNs |
| Kubernetes | `Secret` mounted via `envFrom.secretRef`, ideally backed by External Secrets Operator |
| Docker Swarm / Compose | `secrets:` (file-mounted at `/run/secrets`, not env) |
| Fly.io | `fly secrets set` |
| Render / Railway | Dashboard environment groups / variables |
| Google Cloud Run | Secret Manager references via `--set-secrets` |

`SECRET_KEY_BASE` must be **stable across deploys** (Devise 5 derives token signing from it — see
Phase 5.2) and unique per environment.

---

## Phase 10 — Google Cloud OAuth credentials

Login will not work until this is done.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → OAuth consent screen.** Choose *External*, set an app name and support email.
   While in *Testing*, add your own Google account under **Test users** or you will get
   `403 access_denied`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   - Application type: **Web application**
   - **Authorised JavaScript origins:** `http://localhost:3000`
   - **Authorised redirect URIs:** `http://localhost:3000/users/auth/google_oauth2/callback`
4. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. For each additional environment, add its exact callback URL too. The redirect URI must match
   **character for character**, including scheme, port, and trailing path — `https` vs `http` and a
   missing port are the two most common causes of `redirect_uri_mismatch`.

Scopes: `email,profile` only. Do not request more than you use — the consent screen shows every
scope and broader scopes trigger Google verification review.

---

## Phase 11 — Run it (Docker Compose)

### 11.1 Services

| Service | Image | Process | Purpose |
|---|---|---|---|
| `postgres` | `postgres:18` | `postgres` | Database + queue backend |
| `web` | app image | `bin/rails server` | Inertia pages + `/graphql` + health |
| `worker` | app image | `bin/jobs` | Solid Queue supervisor |
| `vite` | app image | `bin/vite dev` | Dev-only HMR server |

`web` and `worker` are the **same image running different commands** (`task.md` §25). That
guarantees the worker has identical code and gems to the web tier.

### 11.2 Build and start

```bash
docker compose build

# Database first, so the app's readiness check can pass
docker compose up -d postgres
docker compose exec postgres pg_isready -U sourcebox

# Schema
docker compose run --rm web bin/rails db:prepare

# Everything
docker compose up
```

Or run tiers individually, as `task.md` §25 asks:

```bash
docker compose up web
docker compose up worker
```

### 11.3 Open the app

- App: <http://localhost:3000>
- Vite dev server (assets only, not the app): <http://localhost:3036>

### 11.4 First-run ordering gotcha

`web` depends on `postgres` being *healthy*, not merely started. Ensure the Compose healthcheck uses
`pg_isready`, and that `web`/`worker` declare `depends_on: postgres: condition: service_healthy`.
Without it, the first `docker compose up` races and the app exits with
`could not connect to server`.

---

## Phase 12 — Run it (local, no Docker)

Only if you have Ruby 3.4, Node 24, and PostgreSQL 18 natively.

```bash
# 1. Dependencies
bundle install
npm install

# 2. PostgreSQL 18 (macOS/Homebrew)
brew install postgresql@18
brew services start postgresql@18
createuser -s sourcebox
psql -U postgres -c "ALTER USER sourcebox WITH PASSWORD 'sourcebox';"

# 3. Point .env at localhost
sed -i '' 's/^POSTGRES_HOST=.*/POSTGRES_HOST=localhost/' .env

# 4. Schema
bin/rails db:prepare
```

Then run the three processes. `vite install` already created `Procfile.dev` containing the
`vite: bin/vite dev` line — add the other two so it reads:

```procfile
vite:   bin/vite dev
web:    bin/rails server -p 3000
worker: bin/jobs
```

and start them together:

```bash
gem install foreman
foreman start -f Procfile.dev
```

Or use three terminals if you prefer readable logs per process.

---

## Phase 13 — Verify the installation

Work through all six checks. Each one isolates a different layer.

### 13.1 Process liveness

```bash
curl -fsS http://localhost:3000/health
# {"status":"ok"}
```

`/health` must not touch the database (`task.md` §26) — it only proves the process is alive. If it
queried PostgreSQL, a brief database blip would make your orchestrator kill otherwise-healthy web
containers.

### 13.2 Dependency readiness

```bash
curl -fsS http://localhost:3000/ready
# {"status":"ready","checks":{"database":"ok","queue":"ok"}}
```

`/ready` checks that dependencies are reachable and should return `503` when they are not. This is
the endpoint a load balancer uses to decide whether to send traffic.

```bash
# Prove it fails correctly
docker compose stop postgres
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/ready   # 503
docker compose start postgres
```

### 13.3 Assets

```bash
# Development: Vite dev server is serving and the React refresh preamble is present
curl -fsS http://localhost:3000/ | grep -E '@vite/client|vite-dev'

# Production build works
nd 'npm run typecheck && npm run build'
ls -la public/vite/.vite/manifest.json
```

### 13.4 Inertia page render

```bash
# A normal browser request returns HTML with the Inertia data-page payload
curl -fsS http://localhost:3000/login | grep -o 'data-page' | head -1

# An Inertia XHR request returns JSON instead
curl -fsS http://localhost:3000/login \
  -H 'X-Inertia: true' -H 'X-Inertia-Version: 1' | head -c 200
```

### 13.5 GraphQL

Unauthenticated requests must be rejected by the schema, not by a 500:

```bash
curl -fsS http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ currentUser { id email } }"}'
# {"data":{"currentUser":null}}  — or an error with extensions.code = "UNAUTHENTICATED"
```

Confirm the safeguards are live:

```bash
# Depth limit (task.md §6)
curl -fsS http://localhost:3000/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ dashboard(id:\"1\"){ user { dashboards { user { dashboards { user { id }}}}}}}"}'
# => "Query has depth of N, which exceeds max depth of 12"

# Introspection policy in production
RAILS_ENV=production curl -fsS http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name } } }"}'
# => error, because disable_introspection_entry_points is active
```

Verify no internal details leak: no response should ever contain `ActiveRecord::`, a file path, or
a SQL fragment.

### 13.6 Background jobs and correlation

```bash
docker compose exec web bin/rails runner \
  'Rails.event.notify("smoke.test", user_id: 1); AnalyticsEventJob.perform_later(name: "smoke")'

docker compose logs worker | tail -20
```

You are looking for structured JSON with a shared `request_id` flowing from the request through
`Rails.event` into the job (`task.md` §32):

```json
{"event":"job.completed","job_class":"AnalyticsEventJob","job_id":"...","queue":"analytics","request_id":"abc123","duration_ms":87,"status":"success"}
```

Also confirm logs are single-line JSON on stdout:

```bash
docker compose logs web | tail -5 | python3 -c 'import json,sys; [json.loads(l) for l in sys.stdin if l.strip().startswith("{")]' && echo "OK: parseable JSON"
```

### 13.7 End-to-end login

1. Visit <http://localhost:3000/login>.
2. Click **Continue with Google** — the browser should do a **full page navigation** (watch the
   Network tab: a document request, not an XHR) to `accounts.google.com`.
3. Approve consent. You land on `/dashboard` with your Google avatar, name, and email.
4. Toggle something on the dashboard — the change should render instantly (optimistic), then a
   `POST /graphql` confirms it.
5. Confirm persistence:
   ```bash
   docker compose exec postgres psql -U sourcebox -d sourcebox_development \
     -c 'select id, user_id, ui_state from dashboards;'
   ```
6. Confirm rollback: stop the web container mid-toggle, or temporarily raise in the mutation, and
   verify the UI reverts to its previous state instead of staying wrong.

---

## Phase 14 — Production build and deploy

### 14.1 Build the production image

The `Dockerfile` is multi-stage (`base → dependencies → build → production`, `task.md` §24). The
production stage must run as non-root, contain no build toolchain, and ship precompiled assets.

```bash
docker build -t sourcebox:$(git rev-parse --short HEAD) .
```

Asset precompilation happens **at image build time**, not at boot. Set a placeholder so the
`assets:precompile` step doesn't demand real secrets:

```dockerfile
RUN SECRET_KEY_BASE=dummy_for_precompile_only \
    bundle exec rails assets:precompile
```

### 14.2 Verify the image before pushing

```bash
# Non-root
docker run --rm sourcebox:latest id
# uid=1000(rails) gid=1000(rails) — must not be uid=0

# No build toolchain left behind
docker run --rm sourcebox:latest sh -lc 'command -v gcc make || echo "OK: no compilers"'

# No secrets baked in
docker history --no-trunc sourcebox:latest | grep -iE 'secret|password|client_secret' && echo "LEAK" || echo "OK"

# Assets present
docker run --rm sourcebox:latest ls public/vite/.vite/manifest.json

# Size sanity
docker images sourcebox --format '{{.Size}}'
```

### 14.3 Push and release

```bash
docker tag sourcebox:$(git rev-parse --short HEAD) $REGISTRY/sourcebox:$(git rev-parse --short HEAD)
docker push $REGISTRY/sourcebox:$(git rev-parse --short HEAD)
```

### 14.4 Release ordering

Run migrations as a **separate one-off task using the new image, before** the new web/worker
containers start serving:

```bash
docker run --rm --env-file=<(platform-secrets) $REGISTRY/sourcebox:$SHA bin/rails db:prepare
```

Then roll `web`, then `worker`. Keep migrations backward-compatible (expand/contract) so the old
code can still run against the new schema during the rollout — that is what makes rollback safe.

Rollback = redeploy the previous image tag. It is only safe if you never ship a destructive
migration in the same release as the code that stops using the column; split those across two
releases.

### 14.5 Platform notes

Nothing here requires Kubernetes. The image is a plain 12-factor container: one stateless web
process, one worker process, one PostgreSQL. It maps directly onto AWS ECS/Fargate (two services,
one task definition family), Fly.io (`fly.toml` `[processes]`), Render (a web service + a background
worker), Railway, or Google Cloud Run — with the caveat that Cloud Run scales to zero and is a poor
fit for the *worker*, so run the worker on something always-on (Cloud Run **worker pools**, GKE, or
Compute Engine).

Scale web on request latency/CPU. Scale workers on queue depth
(`SolidQueue::ReadyExecution.count`), not CPU.

---

## Everyday commands

Commands prefixed with `docker compose exec` run **inside the already-running container**;
`docker compose run --rm` starts a **new throwaway container** (use this when `web` isn't up).

```bash
# Lifecycle
docker compose build                 # rebuild images after Gemfile/package.json changes
docker compose up                    # start everything, logs in foreground
docker compose up -d                 # start detached
docker compose down                  # stop and remove containers (keeps volumes)
docker compose down -v               # ALSO deletes the database volume — destroys data
docker compose ps                    # what's running
docker compose restart web

# Logs (structured JSON on stdout, task.md §37)
docker compose logs -f web
docker compose logs -f worker
docker compose logs --tail=100 web | jq 'select(.event == "graphql.request")'

# Rails
docker compose exec web bin/rails console
docker compose exec web bin/rails db:migrate
docker compose exec web bin/rails db:rollback
docker compose exec web bin/rails routes | grep -E 'graphql|auth|health'
docker compose exec web bin/rails runner 'puts User.count'
docker compose exec web bin/rails test

# Database shell
docker compose exec postgres psql -U sourcebox -d sourcebox_development

# Frontend
docker compose exec vite npm run typecheck
docker compose exec vite npm run build
docker compose run --rm vite npm install <pkg>   # then rebuild the image

# Solid Queue
docker compose exec web bin/rails solid_queue:check     # validate config without starting
docker compose exec web bin/rails runner 'puts SolidQueue::Job.count'
docker compose exec web bin/rails runner 'puts SolidQueue::FailedExecution.count'
docker compose logs -f worker

# Adding a gem (must rebuild — Gemfile.lock is baked into the image)
docker compose run --rm web bundle add <gem>
docker compose build web worker
```

---

## Troubleshooting

### `Cannot connect to the Docker daemon`
Docker Desktop is installed but not running. `open -a Docker`, then wait for
`docker info` to succeed.

### `Your Ruby version is 2.6.10, but your Gemfile specified 3.4.x`
You are using macOS system Ruby. Use the Docker path, or install Ruby 3.4 via
`rbenv install 3.4.5` / `asdf install ruby 3.4.5`. Never `sudo gem install` into system Ruby.

### `could not connect to server: Connection refused` on first `up`
`web` started before PostgreSQL was accepting connections. Add a `pg_isready` healthcheck to
`postgres` and `depends_on: { postgres: { condition: service_healthy } }` to `web` and `worker`.
Recover with `docker compose up -d postgres`, wait, then `docker compose up`.

### `Not found. Authentication passthru.` when clicking Google login
The OmniAuth request phase received a GET. Confirm `omniauth-rails_csrf_protection` is installed,
that the login button is a real `<form method="post">` with an `authenticity_token` hidden field,
and that the action is `/users/auth/google_oauth2` (not `/users/auth/google`). See Phase 5.4.

### `redirect_uri_mismatch` from Google
The callback URL in Google Cloud Console must match exactly, including scheme and port:
`http://localhost:3000/users/auth/google_oauth2/callback`.

### `403 access_denied` from Google
Your OAuth consent screen is in *Testing* and your account is not in the **Test users** list.

### `ActionController::InvalidAuthenticityToken` on `POST /graphql`
The GraphQL client is not sending the CSRF token. `app/frontend/lib/graphql.ts` must read
`meta[name="csrf-token"]` and send it as the `X-CSRF-Token` header. Do not disable
`protect_from_forgery` — the session cookie is the auth mechanism, so CSRF protection is load-bearing.

### Vite assets 404, or the page renders unstyled
- Is the `vite` service running? `docker compose ps vite`
- Is `config/vite.json` development `host` set to `0.0.0.0`? A `localhost` binding inside a
  container is unreachable from the host browser.
- Is `vite_react_refresh_tag` **before** `vite_javascript_tag` in the layout? The refresh preamble
  must be installed before any component module is evaluated.

### HMR doesn't update the browser
The websocket can't reach the dev server. Set `server.hmr.host = 'localhost'` in `vite.config.ts`
and publish port `3036` in Compose.

### `Unknown attribute 'provider'`
The `AddOmniauthToUsers` migration hasn't run. `docker compose exec web bin/rails db:migrate`.

### Tailwind classes have no effect
You are following v3 instructions. Delete `tailwind.config.js` and `postcss.config.js`, ensure
`@import "tailwindcss";` is the first line of `app/frontend/styles/application.css`, that the CSS is
imported from `application.tsx`, and that `tailwindcss()` is in the `vite.config.ts` plugins array.

### `table "solid_queue_jobs" does not exist`
You ran `db:migrate` instead of `db:prepare`, so `db/queue_schema.rb` was never loaded into the
`queue` database. Run `bin/rails db:prepare` (or `bin/rails db:schema:load:queue`). See Phase 7.2.

### `rails solid_queue:install:migrations` → `Don't know how to build task`
Expected. That task no longer exists in solid_queue 1.7. Use
`bin/rails generate solid_queue:install`. See Phase 7 and Appendix A.

### Jobs enqueue but never run
The `worker` container isn't running or is pointed at the wrong database.
`docker compose logs worker`, then `docker compose exec web bin/rails solid_queue:check`. Also
confirm `config.solid_queue.connects_to` matches the environment you're running.

### npm peer warnings about `oxc-transform-react` / `babel-plugin-react-compiler`
Harmless. Those peers of `@vitejs/plugin-react@6` are declared `optional: true`.

### GraphQL returns `Query has depth of N, which exceeds max depth of 12`
Working as designed (`task.md` §6). Flatten the query or raise `max_depth` deliberately.

---

## Appendix A — Deviations from `task.md`

`task.md` §51 requires verifying current APIs rather than trusting old examples. Four instructions
in the spec are outdated as of the pinned versions; this runbook uses the corrected form.

| `task.md` says | Reality (verified 2026-09-13) | This runbook uses |
|---|---|---|
| §12, §44: `rails solid_queue:install:migrations` | Task does not exist in solid_queue 1.7.0. `lib/solid_queue/tasks.rb` defines only `install`, `update`, `start`, `check`, and the engine ships no `db/migrate`, so the generic engine migration-copy task has nothing to copy. The installer emits `db/queue_schema.rb`. | `bin/rails generate solid_queue:install` + `bin/rails db:prepare` (Phase 7) |
| §14: OAuth path `/users/auth/google` | Devise derives the path from the strategy name, which is `google_oauth2`. | `/users/auth/google_oauth2` (Phase 5.3) |
| §14: `window.location = "/users/auth/google"` | A GET request phase is rejected by OmniAuth 2.x (CVE-2015-9284). A bare `window.location` assignment cannot carry a CSRF token. | Native `<form method="post">` with `authenticity_token`, which is both a full-page navigation *and* a POST (Phase 5.4) |
| §20: "current recommended Tailwind setup" implying a config file | Tailwind v4 removed `tailwind.config.js`, `postcss.config.js`, and `npx tailwindcss init`. | `@tailwindcss/vite` plugin + CSS-first `@import "tailwindcss"` / `@theme` (Phase 4) |

Two further notes where the spec is ambiguous rather than wrong:

- **§12 "simplest safe architecture" for Solid Queue.** Because solid_queue 1.7 ships a schema file
  targeting a separate `queue` database, the path with the fewest manual steps is now a separate
  `queue` database on the *same* PostgreSQL server. This is still one server and zero Redis. The
  single-database variant is documented in Phase 7.2 Option 2 and requires hand-writing a migration.
- **§8 `GraphQL::Types::JSON` vs typed inputs.** `ui_state` is stored as JSONB, but the mutation
  input should be strongly typed for the stable parts of the state (theme, layout, visible widgets)
  and fall back to a JSON scalar only for genuinely open-ended per-widget settings. A fully
  `JSON`-typed mutation input gives up schema validation, introspection, and client typegen at
  exactly the boundary where untrusted client data enters the database.

---

## What's next

This runbook covers bootstrapping and running. The architecture documentation that `task.md`
requires — the Inertia-vs-GraphQL boundary, `useHttp` vs the GraphQL client, the JSONB strategy,
the observability design, the scaling story, and the security checklist — belongs in `README.md`.
