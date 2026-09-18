#!/bin/bash
# Container entrypoint for the backend and worker containers.
#
# Deliberately does NOT run migrations. Two containers starting at once would race on
# the same schema, and an entrypoint that migrates makes every container restart a
# schema-changing event. `./dev` and the production release process run database
# preparation once, as an explicit step.
#
# Never runs anything destructive. No db:reset, no db:drop, no db:schema:load on an
# existing database.
set -euo pipefail

# Remove a stale server.pid left behind by a container that was killed rather than
# stopped, which otherwise makes Puma refuse to boot.
if [ -f tmp/pids/server.pid ]; then
  rm -f tmp/pids/server.pid
fi

# Wait for PostgreSQL before starting anything that needs it. Compose health checks
# already gate startup, but this keeps the image correct outside Compose too (ECS,
# Kubernetes, a bare `docker run`).
wait_for_database() {
  local attempts=${DB_WAIT_ATTEMPTS:-30}
  local i=1
  local output=""

  while [ "$i" -le "$attempts" ]; do
    if output=$(bin/rails runner 'ActiveRecord::Base.connection.select_value("SELECT 1")' 2>&1); then
      return 0
    fi

    # An application that cannot boot is NOT a database that is not ready, and treating
    # them the same way turns a one-line initializer bug into 60 seconds of misleading
    # "waiting for database" output followed by the wrong error. If the failure is not
    # connection-related, fail immediately and show the real exception.
    if ! printf '%s' "$output" | grep -qiE 'could not connect|connection refused|could not translate host|the database system is starting up|Connection reset|PG::ConnectionBad|ActiveRecord::(NoDatabaseError|ConnectionNotEstablished)'; then
      echo '{"event":"entrypoint.boot_failed","level":"error","reason":"application failed to boot; this is not a database connectivity problem"}' >&2
      printf '%s\n' "$output" >&2
      return 1
    fi

    echo "{\"event\":\"entrypoint.waiting_for_database\",\"attempt\":$i,\"of\":$attempts}"
    sleep 2
    i=$((i + 1))
  done

  echo '{"event":"entrypoint.database_unreachable","level":"error"}' >&2
  printf '%s\n' "$output" >&2
  return 1
}

case "${1:-}" in
  # Processes that talk to the database.
  bin/rails | ./bin/rails | bin/jobs | ./bin/jobs | docker/start-web.sh | ./docker/start-web.sh)
    wait_for_database
    ;;
esac

exec "$@"
