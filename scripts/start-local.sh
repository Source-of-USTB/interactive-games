#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

source scripts/logging.sh
ensure_run_context "$project_dir"
run_log="$RUN_LOG_DIR/run.log"
start_run_logging "$run_log"

scripts/preflight.sh
public_origin_override="${PUBLIC_ORIGIN:-}"
set -a
source .env
set +a
if [[ -n "$public_origin_override" ]]; then
  export PUBLIC_ORIGIN="$public_origin_override"
fi

if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  run_interactive pnpm build
fi
mkdir -p runtime
pnpm start &
server_pid=$!

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ -n "${godot_pid:-}" ]] && process_is_running "$godot_pid"; then
    kill "$godot_pid" 2>/dev/null || true
  fi
  if [[ -n "${godot_pid:-}" ]]; then
    wait "$godot_pid" 2>/dev/null || true
  fi
  if process_is_running "$server_pid"; then
    kill "$server_pid" 2>/dev/null || true
  fi
  wait "$server_pid" 2>/dev/null || true
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

server_failure_status() {
  local status
  if wait "$server_pid"; then
    status=0
  else
    status=$?
  fi
  echo "[ERROR] Game server exited unexpectedly with status ${status}." >&2
  if [[ -f "$RUN_LOG_DIR/server.log" ]]; then
    echo "[ERROR] Last server log lines:" >&2
    tail -n 20 "$RUN_LOG_DIR/server.log" >&2
  fi
  return "$status"
}

if ! process_is_running "$server_pid"; then
  server_failure_status || true
  exit 1
fi

for _attempt in {1..40}; do
  if curl --noproxy '*' --silent --fail "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
    break
  fi
  if ! process_is_running "$server_pid"; then
    server_failure_status || true
    exit 1
  fi
  sleep 0.25
done

if ! curl --noproxy '*' --silent --fail "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
  if ! process_is_running "$server_pid"; then
    server_failure_status || true
  else
    echo "[ERROR] Game server did not become ready within 10 seconds." >&2
  fi
  exit 1
fi

if [[ "${PUBLIC_HEALTHCHECK:-false}" == "true" ]]; then
  public_check_origin="${PUBLIC_HEALTHCHECK_ORIGIN:-$PUBLIC_ORIGIN}"
  echo "[INFO] Checking player path: ${public_check_origin}"
  if [[ "$public_check_origin" != "$PUBLIC_ORIGIN" ]]; then
    echo "[WARN] Public URL is not checked from this computer. Verify it from a phone: ${PUBLIC_ORIGIN}"
  fi
  public_check_log="$RUN_LOG_DIR/public-check.log"
  public_ready=false
  for _attempt in {1..20}; do
    if node --use-env-proxy scripts/check-public.mjs "$public_check_origin" >"$public_check_log" 2>&1; then
      public_ready=true
      break
    fi
    sleep 1
  done

  if [[ "$public_ready" != "true" ]]; then
    echo "[ERROR] Player path validation failed. The QR code will not be shown." >&2
    echo "[ERROR] Check result:" >&2
    tail -n 20 "$public_check_log" >&2
    echo "[INFO] Run the matching diagnose-*-public.sh script for tunnel details." >&2
    exit 1
  fi
  if [[ "$public_check_origin" == "$PUBLIC_ORIGIN" ]]; then
    echo "[INFO] Public player path is ready: HTTP + session + bootstrap + WebSocket."
  else
    echo "[INFO] Local player gateway is ready: HTTP + session + bootstrap + WebSocket."
  fi
fi

export GAME_SERVER_WS="ws://127.0.0.1:${PORT:-3000}/ws"
echo "[INFO] Admin: http://127.0.0.1:${PORT:-3000}/admin"
echo "[INFO] Starting Godot display. Press F11 for fullscreen."
set +e
godot --path apps/godot --fullscreen &
godot_pid=$!
while process_is_running "$godot_pid"; do
  if ! process_is_running "$server_pid"; then
    server_failure_status || true
    kill "$godot_pid" 2>/dev/null || true
    wait "$godot_pid" 2>/dev/null || true
    exit 1
  fi
  sleep 0.25
done
if wait "$godot_pid"; then
  godot_status=0
else
  godot_status=$?
fi
set -e

if [[ "${KEEP_SERVER_AFTER_GODOT:-false}" == "true" ]]; then
  if ! process_is_running "$server_pid"; then
    server_failure_status || true
    exit 1
  fi
  echo "[INFO] Godot exited with status ${godot_status}. The game server remains running."
  echo "[INFO] Keep this terminal open. Press Ctrl+C to stop the run."
  while process_is_running "$server_pid"; do
    sleep 1
  done
  server_failure_status || true
  exit 1
else
  exit "$godot_status"
fi
