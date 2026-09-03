#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

port="${PORT:-}"
if [[ -f .env ]]; then
  configured_port="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
  port="${configured_port:-$port}"
fi
port="${port:-3000}"

failed=0
check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "[OK] $1: $(command -v "$1")"
  else
    echo "[FAIL] Missing command: $1"
    failed=1
  fi
}

check_command node
check_command pnpm
check_command godot
check_command openssl
check_command ip
check_command rg
check_command script
check_command perl

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( node_major < 24 )); then
  echo "[FAIL] Node.js 24 or newer is required."
  failed=1
else
  echo "[OK] Node.js $(node --version)"
fi

if [[ ! -f .env ]]; then
  echo "[FAIL] Missing .env. Run scripts/setup-local.sh first."
  failed=1
else
  echo "[OK] .env is present."
  if rg -q 'change-this|development-' .env; then
    echo "[FAIL] .env still contains development credentials."
    failed=1
  else
    echo "[OK] Runtime credentials are configured."
  fi
fi

if ss -ltn 2>/dev/null | rg -q ":${port}\\s"; then
  echo "[FAIL] Port ${port} is already in use."
  failed=1
else
  echo "[OK] Port ${port} is available."
fi

if [[ -d apps/web/dist && -f packages/game-core/dist/index.js && -f apps/server/dist/index.js ]]; then
  echo "[OK] Production build is present."
else
  echo "[WARN] Production build is missing. The start script will build it."
fi

route_info="$(ip route get 1.1.1.1 2>/dev/null || true)"
local_ip="$(awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' <<< "$route_info")"
echo "[INFO] Detected local URL: http://${local_ip:-127.0.0.1}:${port}"
if command -v cloudflared >/dev/null 2>&1; then
  echo "[OK] cloudflared is installed. Public mode is available."
else
  echo "[INFO] cloudflared is not installed. Local Wi-Fi mode is still available."
fi

exit "$failed"
