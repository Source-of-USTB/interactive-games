#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ -f .env ]]; then
  echo ".env 已存在，未覆盖。"
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
  echo "已生成 .env，本地入口：http://${local_ip}:3000"
fi

pnpm install
pnpm build
echo "初始化完成。运行 scripts/start-local.sh 启动全部本地端。"
