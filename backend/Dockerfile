# syntax=docker/dockerfile:1
#
# Backend image: Rails, and nothing else.
#
#   base -> dependencies -> build -> production
#                                 \-> development
#
# Notably absent: Node, npm, node_modules and any asset compilation. The frontend builds
# itself in frontend/Dockerfile and publishes a manifest that this app reads at runtime
# (see FrontendAssets::Manifest), so there is no JavaScript toolchain in this image at all.
# That is what keeps the two independently buildable -- and it makes this image both
# smaller and faster to build.
#
# `web` and `worker` are the same image with different commands, so the request path and
# the queue can never run mismatched code.

ARG RUBY_VERSION=3.4.10


# ---------------------------------------------------------------------------
# base: runtime OS layer shared by every other stage
# ---------------------------------------------------------------------------
FROM ruby:${RUBY_VERSION}-slim-trixie AS base

# Runtime packages only. Compilers live in `dependencies` and never reach production.
#   libpq5       - PostgreSQL client library
#   libjemalloc2 - materially lower RSS for long-running Ruby processes
RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y \
      libpq5 libjemalloc2 libyaml-0-2 tzdata \
 && rm -rf /var/lib/apt/lists/* /var/log/*

# Optional corporate TLS-inspecting proxy CA (Zscaler, Netskope, and similar).
#
# Without this, `bundle install` fails with opaque TLS errors on networks that intercept
# HTTPS, because the container trusts neither the proxy's root certificate nor anything
# signed by it.
#
# The directory is committed empty. Drop a .crt into backend/docker/certs/ -- or let
# ./dev copy your host's automatically -- and it is trusted; otherwise this is a no-op, so
# nothing machine-specific is baked into the image by default.
COPY docker/certs/ /usr/local/share/ca-certificates/extra/
RUN if ls -A /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then \
      update-ca-certificates; \
    fi

ENV RAILS_ENV=production \
    BUNDLE_PATH=/usr/local/bundle \
    BUNDLE_WITHOUT=development:test \
    BUNDLE_DEPLOYMENT=1 \
    # Structured JSON logs go to stdout for the container runtime to collect.
    RAILS_LOG_TO_STDOUT=1 \
    LD_PRELOAD=libjemalloc.so.2 \
    MALLOC_ARENA_MAX=2

WORKDIR /rails

# Non-root from the start. Running as root would let a code-execution bug rewrite the
# application itself.
RUN groupadd --system --gid 1000 rails \
 && useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash


# ---------------------------------------------------------------------------
# dependencies: compile gems
# ---------------------------------------------------------------------------
FROM base AS dependencies

RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y \
      build-essential git libpq-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

# Gems are installed BEFORE application code is copied, so editing a controller does not
# invalidate this layer.
#
# .ruby-version is required, not incidental: the Gemfile declares
# `ruby file: ".ruby-version"`, so bundler cannot resolve without it.
COPY Gemfile Gemfile.lock .ruby-version ./
RUN bundle install --jobs 4 --retry 3 \
 && rm -rf "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git


# ---------------------------------------------------------------------------
# build: precompile bootsnap cache
# ---------------------------------------------------------------------------
FROM dependencies AS build

COPY . .

# Bootsnap cache for gems and application code, so production boot time is not spent
# re-parsing Ruby. SECRET_KEY_BASE_DUMMY lets Rails boot with a throwaway key for the
# duration of the build, so no real secret is needed and none can be captured in a layer.
RUN SECRET_KEY_BASE_DUMMY=1 bundle exec bootsnap precompile --gemfile app/ lib/ \
 && rm -rf tmp/cache


# ---------------------------------------------------------------------------
# development: dev/test gems, code reloading
# ---------------------------------------------------------------------------
FROM dependencies AS development

ENV RAILS_ENV=development \
    BUNDLE_WITHOUT="" \
    BUNDLE_DEPLOYMENT=0

# Dev needs the development and test groups that `dependencies` excluded.
RUN bundle install --jobs 4 --retry 3

COPY . .

RUN mkdir -p tmp/pids log \
 && chown -R rails:rails /rails /usr/local/bundle

USER 1000:1000

ENTRYPOINT ["docker/entrypoint.sh"]
EXPOSE 3000
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]


# ---------------------------------------------------------------------------
# production: minimal runtime
# ---------------------------------------------------------------------------
FROM base AS production

# Only the artefacts. No compilers, no git, no build cache.
COPY --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --from=build /rails /rails

RUN rm -rf /rails/.git /rails/test /rails/tmp/cache \
 && mkdir -p /rails/tmp/pids /rails/log \
 && chown -R rails:rails /rails/log /rails/tmp

USER 1000:1000

ENTRYPOINT ["docker/entrypoint.sh"]

EXPOSE 3000

# Liveness only: answers "is the process up". Uses Ruby rather than curl so the image does
# not need an HTTP client installed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ruby -e "require 'net/http'; exit(Net::HTTP.get_response(URI('http://127.0.0.1:3000/health')).code == '200' ? 0 : 1)"

CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
