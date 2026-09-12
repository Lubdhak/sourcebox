# syntax=docker/dockerfile:1
#
# Multi-stage build:  base -> dependencies -> build -> production
#                                         \-> development
#
# `production` is minimal, runs as a non-root user, contains no compilers and no
# secrets, and ships prebuilt Vite assets. `development` keeps the toolchain so Vite
# can run its dev server and Rails can reload code.

ARG RUBY_VERSION=3.4.10
ARG NODE_VERSION=24

# Node binaries are lifted from the official image rather than installed via a distro
# package, so the version is exact and reproducible.
FROM node:${NODE_VERSION}-slim AS node


# ---------------------------------------------------------------------------
# base: runtime OS layer shared by every other stage
# ---------------------------------------------------------------------------
FROM ruby:${RUBY_VERSION}-slim-trixie AS base

# Runtime packages only. No compilers here; they live in `dependencies` and never
# reach the production image.
#   libpq5   - PostgreSQL client library
#   libjemalloc2 - materially lower RSS for long-running Ruby processes
RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y \
      libpq5 libjemalloc2 libyaml-0-2 tzdata \
 && rm -rf /var/lib/apt/lists/* /var/log/*

# Optional corporate TLS-inspecting proxy CA (Zscaler, Netskope, corporate MITM).
#
# Without this, `bundle install` and `npm install` fail with opaque TLS errors on
# networks that intercept HTTPS, because the container trusts neither the proxy's root
# nor, in Node's case, the system store at all.
#
# The directory is committed empty. Drop a .crt in docker/certs/ (or let ./dev copy
# your host's automatically) and it is trusted; otherwise this is a no-op. Nothing
# environment-specific is baked into the image by default.
COPY docker/certs/ /usr/local/share/ca-certificates/extra/
RUN if ls -A /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then \
      update-ca-certificates; \
      cat /usr/local/share/ca-certificates/extra/*.crt > /usr/local/share/ca-certificates/extra-bundle.pem; \
    else \
      : > /usr/local/share/ca-certificates/extra-bundle.pem; \
    fi

# Node ships its own CA list and ignores the system store, so it needs pointing at the
# extra bundle explicitly. Harmless when the bundle is empty.
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/extra-bundle.pem

ENV RAILS_ENV=production \
    BUNDLE_PATH=/usr/local/bundle \
    BUNDLE_WITHOUT=development:test \
    BUNDLE_DEPLOYMENT=1 \
    # Structured JSON logs go to stdout for the container runtime to collect.
    RAILS_LOG_TO_STDOUT=1 \
    LD_PRELOAD=libjemalloc.so.2 \
    MALLOC_ARENA_MAX=2

WORKDIR /rails

# Non-root from the start. Running as root would let a code-execution bug write to the
# application itself.
RUN groupadd --system --gid 1000 rails \
 && useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash


# ---------------------------------------------------------------------------
# dependencies: compile gems and install node modules
# ---------------------------------------------------------------------------
FROM base AS dependencies

RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y \
      build-essential git libpq-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Gems and packages are copied and installed BEFORE application code, so editing a
# controller does not invalidate the dependency layers.
# .ruby-version is required here, not incidental: the Gemfile declares
# `ruby file: ".ruby-version"`, so bundler cannot resolve without it.
COPY Gemfile Gemfile.lock .ruby-version ./
RUN bundle install --jobs 4 --retry 3 \
 && rm -rf "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git

# `npm ci` when a lockfile is present (reproducible), `npm install` otherwise.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi


# ---------------------------------------------------------------------------
# build: precompile assets
# ---------------------------------------------------------------------------
FROM dependencies AS build

COPY . .

# Bootsnap cache for the gems and app, so boot time in production is not spent
# re-parsing Ruby.
RUN bundle exec bootsnap precompile --gemfile app/ lib/

# Vite build. SECRET_KEY_BASE_DUMMY makes Rails boot with a throwaway key for the
# duration of the build, so no real secret is needed and none can be captured in a
# layer.
RUN SECRET_KEY_BASE_DUMMY=1 bundle exec vite build

RUN rm -rf node_modules/.vite tmp/cache


# ---------------------------------------------------------------------------
# development: full toolchain, code reloading, Vite dev server
# ---------------------------------------------------------------------------
FROM dependencies AS development

ENV RAILS_ENV=development \
    BUNDLE_WITHOUT="" \
    BUNDLE_DEPLOYMENT=0

# Dev needs the development/test gem groups that `dependencies` excluded.
RUN bundle install --jobs 4 --retry 3

COPY . .

RUN mkdir -p tmp/pids log storage public/vite public/vite-dev \
 && chown -R rails:rails /rails /usr/local/bundle

USER 1000:1000

ENTRYPOINT ["docker/entrypoint.sh"]
EXPOSE 3000
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]


# ---------------------------------------------------------------------------
# production: minimal runtime
# ---------------------------------------------------------------------------
FROM base AS production

# Only the artefacts. No compilers, no node, no node_modules, no npm cache.
COPY --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --from=build /rails /rails

# Drop build-time leftovers that have no business in a runtime image.
RUN rm -rf /rails/node_modules /rails/.git /rails/test /rails/tmp/cache \
 && mkdir -p /rails/tmp/pids /rails/log \
 && chown -R rails:rails /rails/log /rails/tmp

USER 1000:1000

ENTRYPOINT ["docker/entrypoint.sh"]

EXPOSE 3000

# Liveness only: answers "is the process up". Uses Ruby rather than curl so the image
# does not need an HTTP client installed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ruby -e "require 'net/http'; exit(Net::HTTP.get_response(URI('http://127.0.0.1:3000/health')).code == '200' ? 0 : 1)"

CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
