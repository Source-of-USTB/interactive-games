#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

source scripts/logging.sh
ensure_run_context "$project_dir"
run_log="$RUN_LOG_DIR/run.log"
start_run_logging "$run_log"

if ! command -v ssh >/dev/null 2>&1; then
  echo "[ERROR] OpenSSH client (ssh) is missing." >&2
  exit 1
fi

tunnel_log="$RUN_LOG_DIR/localhost-run.log"
gateway_log="$RUN_LOG_DIR/player-gateway.log"
known_hosts="$project_dir/runtime/ssh-known-hosts"

game_port="${PORT:-}"
if [[ -f .env ]]; then
  configured_port="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
  game_port="${configured_port:-$game_port}"
fi
game_port="${game_port:-3000}"
gateway_port="${PUBLIC_GATEWAY_PORT:-3100}"

PORT="$game_port" PUBLIC_GATEWAY_PORT="$gateway_port" node scripts/player-gateway.mjs >"$gateway_log" 2>&1 &
gateway_pid=$!
tunnel_pid=""

cleanup_tunnel() {
  if [[ -n "$tunnel_pid" ]]; then
    kill "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
  fi
  kill "$gateway_pid" 2>/dev/null || true
  wait "$gateway_pid" 2>/dev/null || true
}
trap cleanup_tunnel EXIT INT TERM

gateway_ready=false
for _attempt in {1..30}; do
  if rg -q '^\[INFO\] Player gateway listening on ' "$gateway_log"; then
    gateway_ready=true
    break
  fi
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "[ERROR] Player gateway failed to start." >&2
    tail -n 40 "$gateway_log" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "$gateway_ready" != "true" ]]; then
  echo "[ERROR] Player gateway did not become ready within 3 seconds." >&2
  tail -n 40 "$gateway_log" >&2
  exit 1
fi

ssh \
  -T \
  -p 22 \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o "UserKnownHostsFile=$known_hosts" \
  -R "80:127.0.0.1:${gateway_port}" \
  nokey@localhost.run \
  -- --output json >"$tunnel_log" 2>&1 &
tunnel_pid=$!

extract_public_origin() {
  rg -o 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.lhr\.life' "$tunnel_log" \
    | head -n 1 \
    || true
}

print_failure_hint() {
  if rg -qi 'connection timed out|operation timed out|connection refused|connection reset' "$tunnel_log"; then
    echo "[ERROR] The SSH connection to localhost.run:22 was blocked or reset." >&2
    echo "[HINT] Try a phone hotspot, then run this script again." >&2
  elif rg -qi 'permission denied' "$tunnel_log"; then
    echo "[ERROR] localhost.run rejected this anonymous tunnel request." >&2
  fi
}

public_origin=""
for _attempt in {1..120}; do
  public_origin="$(extract_public_origin)"
  if [[ -n "$public_origin" ]]; then
    break
  fi
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "[ERROR] Player gateway exited before the tunnel was ready." >&2
    tail -n 40 "$gateway_log" >&2
    exit 1
  fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "[ERROR] localhost.run tunnel failed to start." >&2
    print_failure_hint
    tail -n 100 "$tunnel_log" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ -z "$public_origin" ]]; then
  echo "[ERROR] No localhost.run URL appeared within 30 seconds." >&2
  print_failure_hint
  tail -n 100 "$tunnel_log" >&2
  exit 1
fi

echo "[INFO] Temporary public URL: $public_origin"
echo "[INFO] Starting the game and validating HTTP, session, bootstrap, and WebSocket."
PUBLIC_ORIGIN="$public_origin" \
  PUBLIC_HEALTHCHECK=true \
  KEEP_SERVER_AFTER_GODOT=true \
  scripts/start-local.sh
