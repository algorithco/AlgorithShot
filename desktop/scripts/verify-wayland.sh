#!/usr/bin/env bash
# An isolated software Wayland compositor; no real desktop or screen data.
set -euo pipefail
runtime=$(mktemp -d "${TMPDIR:-/tmp}/algorithshot-wayland.XXXXXX")
weston_pid=''
cleanup() {
  status=$?
  if [[ -n "$weston_pid" ]]; then
    kill "$weston_pid" 2>/dev/null || true
    wait "$weston_pid" 2>/dev/null || true
  fi
  if [[ $status -ne 0 ]]; then cat "$runtime/weston.log" >&2 || true; fi
  rm -rf -- "$runtime"
  exit "$status"
}
trap cleanup EXIT
chmod 700 "$runtime"
export XDG_RUNTIME_DIR="$runtime" XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland WAYLAND_DISPLAY=wayland-algorithshot
unset DISPLAY
weston --backend=headless --renderer=pixman --no-config --idle-time=0 \
  --width=1280 --height=800 --socket="$WAYLAND_DISPLAY" --log="$runtime/weston.log" &
weston_pid=$!
for attempt in {1..100}; do
  [[ -S "$runtime/$WAYLAND_DISPLAY" ]] && break
  kill -0 "$weston_pid" || exit 1
  sleep 0.1
done
[[ -S "$runtime/$WAYLAND_DISPLAY" ]]
dbus-run-session -- "$@"
