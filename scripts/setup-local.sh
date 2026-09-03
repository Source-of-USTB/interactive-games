#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

source scripts/logging.sh
ensure_run_context "$project_dir"
start_run_logging "$RUN_LOG_DIR/run.log"

if [[ -f .env ]]; then
  echo "[INFO] .env already exists; leaving it unchanged."
else
  route_info="$(ip route get 1.1.1.1 2>/dev/null || true)"
  local_ip="$(awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' <<< "$route_info")"
  local_ip="${local_ip:-127.0.0.1}"
  admin_token="$(openssl rand -hex 24)"
  screen_token="$(openssl rand -hex 24)"
  session_secret="$(openssl rand -hex 32)"
  sed \
    -e "s#PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=http://${local_ip}:3000#" \
    -e "s#LOCAL_ORIGIN=.*#LOCAL_ORIGIN=http://${local_ip}:3000#" \
    -e "s#ADMIN_TOKEN=.*#ADMIN_TOKEN=${admin_token}#" \
    -e "s#SCREEN_TOKEN=.*#SCREEN_TOKEN=${screen_token}#" \
    -e "s#SESSION_SECRET=.*#SESSION_SECRET=${session_secret}#" \
    .env.example > .env
  chmod 600 .env
  echo "[INFO] Created .env. Local URL: http://${local_ip}:3000"
fi

run_interactive pnpm install
run_interactive pnpm build
echo "[INFO] Setup complete. Run scripts/start-local.sh to start the local stack."
