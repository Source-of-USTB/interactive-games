#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

source scripts/logging.sh
ensure_run_context "$project_dir"
run_log="$RUN_LOG_DIR/run.log"
start_run_logging "$run_log"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[ERROR] cloudflared is missing. Configure the public tunnel first." >&2
  exit 1
fi
if [[ ! -f deploy/cloudflared.yml ]]; then
  echo "[ERROR] Missing deploy/cloudflared.yml. Copy the example and set the tunnel UUID and hostname." >&2
  exit 1
fi

tunnel_log="$RUN_LOG_DIR/named-tunnel.log"
cloudflared tunnel --config deploy/cloudflared.yml run >"$tunnel_log" 2>&1 &
tunnel_pid=$!
cleanup_tunnel() {
  kill "$tunnel_pid" 2>/dev/null || true
  wait "$tunnel_pid" 2>/dev/null || true
}
trap cleanup_tunnel EXIT INT TERM
scripts/start-local.sh
