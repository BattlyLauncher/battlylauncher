#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DISPLAY:-}" ]; then
  exec xvfb-run -a bash "$0"
fi

export XDG_CURRENT_DESKTOP=GNOME
export DESKTOP_SESSION=gnome
keyring_data="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/battly-qa-keyring.XXXXXX")"
printf %s "$(openssl rand -hex 32)" | env XDG_DATA_HOME="$keyring_data" gnome-keyring-daemon --unlock --components=secrets
for attempt in $(seq 1 50); do
  locked="$(gdbus call --session --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets/aliases/default --method org.freedesktop.DBus.Properties.Get org.freedesktop.Secret.Collection Locked 2>/dev/null || true)"
  if [ "$locked" = '(<false>,)' ]; then break; fi
  sleep 0.1
done
if [ "$locked" != '(<false>,)' ]; then
  echo 'The test Secret Service collection is unavailable or locked.' >&2
  exit 1
fi
echo 'Test Secret Service collection is unlocked.'
exec node "public scripts/linux-launcher-smoke.cjs"
