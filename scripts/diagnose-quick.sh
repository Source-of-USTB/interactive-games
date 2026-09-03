#!/usr/bin/env bash
set -u

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
source scripts/logging.sh
exec > >(colorize_output) 2>&1

port="${PORT:-}"
if [[ -f .env ]]; then
  configured_port="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
  port="${configured_port:-$port}"
fi
port="${port:-3000}"

echo "== Processes =="
process_rows="$(pgrep -af '[c]loudflared.*tunnel|[n]ode dist/index\.js|[g]odot.*apps/godot' 2>/dev/null || true)"
if [[ -n "$process_rows" ]]; then
  echo "$process_rows"
else
  echo "No Quick Tunnel, game server, or Godot process found."
fi

echo
echo "== Local server =="
if curl --noproxy '*' --silent --show-error --fail --max-time 3 "http://127.0.0.1:${port}/api/health"; then
  echo
  echo "Local port ${port} is healthy."
else
  echo "Local port ${port} is not reachable."
fi

echo
echo "== Quick Tunnel logs =="
tunnel_log="$(find "$project_dir/runtime/logs" -mindepth 2 -maxdepth 2 -type f -name 'quick-tunnel.log' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2- | head -n 1)"
if [[ -n "$tunnel_log" && -f "$tunnel_log" ]]; then
  public_origin="$(
    rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" \
      | rg -v '^https://api\.trycloudflare\.com$' \
      | head -n 1 \
      || true
  )"
  if [[ -n "$public_origin" ]]; then
    echo "Latest URL: $public_origin"
  elif rg -q 'api\.trycloudflare\.com.*connection reset by peer|connection reset by peer' "$tunnel_log"; then
    echo "Status: tunnel request failed; no public URL was created."
    echo "Cause: the connection to api.trycloudflare.com:443 was blocked or reset."
    echo "Hint: try a phone hotspot, then run ./scripts/start-quick-public.sh again."
  else
    echo "No valid trycloudflare.com URL was found in the log."
  fi
  echo "Log file: $tunnel_log"
  tail -n 80 "$tunnel_log"
else
  echo "No Quick Tunnel log found. The Quick script may not have run yet."
fi
