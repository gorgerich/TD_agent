#!/bin/bash
set -eu
freshclam --config-file=/etc/clamav/freshclam.conf >/dev/null 2>&1 || {
  printf '%s\n' 'SCANNER_DEFINITIONS_UPDATE_FAILED' >&2
  exit 1
}
pids=""
trap 'kill $pids 2>/dev/null || true; wait 2>/dev/null || true' EXIT
trap 'exit 1' TERM INT
clamd --config-file=/etc/clamav/clamd.conf >/dev/null 2>&1 &
pids="$!"
freshclam --config-file=/etc/clamav/freshclam.conf --daemon --foreground >/dev/null 2>&1 &
pids="$pids $!"
node /app/server.mjs &
pids="$pids $!"
wait -n
exit 1
