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
process_rows="$(pgrep -af '[s]sh.*localhost\.run|[n]ode dist/index\.js|[n]ode scripts/player-gateway\.mjs|[g]odot.*apps/godot' 2>/dev/null || true)"
if [[ -n "$process_rows" ]]; then
  echo "$process_rows"
else
  echo "No localhost.run tunnel, game server, or Godot process found."
fi

echo
echo "== Player gateway =="
gateway_port="${PUBLIC_GATEWAY_PORT:-3100}"
if [[ -f .env ]]; then
  configured_gateway_port="$(sed -n 's/^PUBLIC_GATEWAY_PORT=//p' .env | tail -n 1)"
  gateway_port="${configured_gateway_port:-$gateway_port}"
fi
if curl --noproxy '*' --silent --show-error --fail --max-time 3 "http://127.0.0.1:${gateway_port}/api/health"; then
  echo
  echo "Player gateway is reachable."
else
  echo "Player gateway is not reachable."
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
echo "== localhost.run logs =="
tunnel_log="$(find "$project_dir/runtime/logs" -mindepth 2 -maxdepth 2 -type f -name 'localhost-run.log' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2- | head -n 1)"
if [[ -n "$tunnel_log" && -f "$tunnel_log" ]]; then
  public_origin="$(
    rg -o 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.lhr\.life' "$tunnel_log" \
      | head -n 1 \
      || true
  )"
  if [[ -n "$public_origin" ]]; then
    echo "Latest URL: $public_origin"
  elif rg -qi 'connection timed out|operation timed out|connection refused|connection reset' "$tunnel_log"; then
    echo "Status: the SSH connection to localhost.run:22 was blocked or reset."
    echo "Hint: try a phone hotspot, then run this script again."
  else
    echo "No valid public URL was found in the log."
  fi
  echo "Log file: $tunnel_log"
  tail -n 100 "$tunnel_log"
else
  echo "No localhost.run log found. The Easy Public script may not have run yet."
fi
