#!/bin/bash
set -eu
token="${SCANNER_AUTH_TOKEN:-}"
if [ "${#token}" -lt 32 ]; then
  printf '%s\n' 'SCANNER_AUTH_CONFIGURATION_REQUIRED' >&2
  exit 1
fi
install -d -o clamav -g clamav /run/clamav /var/lib/clamav
exec gosu clamav /bin/bash /app/run.sh
