#!/bin/bash
# Start command for the web service on Render.
#
# This service is not Blueprint-synced (see render.yaml), and its Docker Command field
# passes its value straight through as a raw argv split on whitespace -- no shell, no
# quote-awareness. Neither `a && b` chaining nor a quoted `sh -c "a && b"` wrapper survives
# that trip intact (the latter leaves a literal `"` glued onto the first token, which
# then fails as "command not found"). A single-token script sidesteps the problem
# entirely: paste `docker/start-web.sh` into the dashboard's Start/Docker Command field
# and there is nothing left for a naive splitter to break.
set -euo pipefail

bin/rails db:prepare
bin/rails db:seed

exec bundle exec puma -C config/puma.rb
