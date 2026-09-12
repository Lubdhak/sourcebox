# syntax=docker/dockerfile:1
#
# Frontend image. Builds and runs with no knowledge of the backend.
#
#   base -> dependencies -> build -> production   (nginx serving hashed assets)
#                                 \-> development (Vite dev server with HMR)
#
# The build context is this directory only, so nothing outside frontend/ can be referenced.
# That is enforcement rather than convention: if this Dockerfile builds, the directory can
# become its own repository unchanged.

ARG NODE_VERSION=24


# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base

# Optional corporate TLS-inspecting proxy CA. Node ships its own CA list and ignores the
# system trust store entirely, so it must be pointed at the bundle explicitly.
#
# Committed empty; ./dev populates it from the host when needed. Without this, on an
# intercepted network `npm ci` hangs and then fails with an opaque TLS error.
COPY docker/certs/ /usr/local/share/ca-certificates/extra/
RUN if ls -A /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then \
      cat /usr/local/share/ca-certificates/extra/*.crt > /usr/local/share/ca-certificates/extra-bundle.pem; \
    else \
      : > /usr/local/share/ca-certificates/extra-bundle.pem; \
    fi
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/extra-bundle.pem

# Owned by the unprivileged `node` user (uid 1000, already present in the base image)
# BEFORE anything is installed into it.
#
# This ordering matters more than it looks. Compose masks /app/node_modules with a named
# volume seeded from this image, so the ownership baked in here becomes the volume's
# ownership. Installing as root and switching user afterwards leaves Vite unable to write
# its dependency cache at node_modules/.vite, which fails at runtime with
# `EACCES: permission denied, mkdir '/app/node_modules/.vite/deps_temp_*'`.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node


# ---------------------------------------------------------------------------
# dependencies: install node_modules
# ---------------------------------------------------------------------------
FROM base AS dependencies

# Manifests only, so editing a component does not reinstall the dependency tree.
COPY --chown=node:node package.json package-lock.json* ./

# `npm ci` when a lockfile exists: it installs exactly the locked tree and fails if
# package.json disagrees, which is what makes the build reproducible.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi


# ---------------------------------------------------------------------------
# build: typecheck + vite build
# ---------------------------------------------------------------------------
FROM dependencies AS build

COPY --chown=node:node . .

# Typechecking is part of the build, not a separate CI nicety. `vite build` transpiles
# without checking types, so skipping this would let type errors ship.
RUN npm run typecheck

# Produces dist/assets/*-<hash>.{js,css} and dist/manifest.json. That manifest is the
# entire published interface to the backend.
RUN npm run build


# ---------------------------------------------------------------------------
# development: Vite dev server with HMR
# ---------------------------------------------------------------------------
FROM dependencies AS development

ENV NODE_ENV=development

# Source is bind-mounted over this at run time by docker-compose; copied anyway so the
# image is runnable on its own.
COPY --chown=node:node . .

# node_modules stays in the image (masked by a named volume in compose) rather than being
# bind-mounted from the host. On Docker Desktop for macOS a bind-mounted node_modules means
# tens of thousands of tiny file reads through virtiofs, which turns a 2-second Vite boot
# into minutes.

EXPOSE 5173
CMD ["npm", "run", "dev"]


# ---------------------------------------------------------------------------
# production: nginx serving the hashed build output
# ---------------------------------------------------------------------------
#
# nginx-unprivileged rather than the standard nginx image: the stock image starts as root to
# bind port 80. This one runs as uid 101 throughout and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS production

COPY docker/nginx/frontend.conf /etc/nginx/conf.d/default.conf

# Assets AND the manifest. The manifest is served over HTTP because that is how the backend
# fetches it — the two containers share no volume.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# wget is in the alpine base, so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
