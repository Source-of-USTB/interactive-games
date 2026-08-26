#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

failed=0
check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "[OK] $1: $(command -v "$1")"
  else
    echo "[FAIL] 缺少 $1"
    failed=1
  fi
}

check_command node
check_command pnpm
check_command godot
check_command openssl
check_command ip
check_command rg

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( node_major < 24 )); then
  echo "[FAIL] Node.js 需要 24 或更新版本"
  failed=1
else
  echo "[OK] Node.js $(node --version)"
fi

if [[ ! -f .env ]]; then
  echo "[FAIL] 缺少 .env，请先运行 scripts/setup-local.sh"
  failed=1
else
  echo "[OK] .env 已存在"
  if rg -q 'change-this|development-' .env; then
    echo "[FAIL] .env 仍包含开发密钥"
    failed=1
  else
    echo "[OK] 现场密钥已替换"
  fi
fi

if ss -ltn 2>/dev/null | rg -q ':3000\s'; then
  echo "[FAIL] 3000 端口已被占用"
  failed=1
else
  echo "[OK] 3000 端口可用"
fi

if [[ -d apps/web/dist && -f packages/game-core/dist/index.js && -f apps/server/dist/index.js ]]; then
  echo "[OK] 生产构建已存在"
else
  echo "[WARN] 生产构建尚未生成，启动时会自动构建"
fi

route_info="$(ip route get 1.1.1.1 2>/dev/null || true)"
local_ip="$(awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' <<< "$route_info")"
echo "[INFO] 检测到的本地入口：http://${local_ip:-127.0.0.1}:3000"
if command -v cloudflared >/dev/null 2>&1; then
  echo "[OK] cloudflared 已安装，可启用公网入口"
else
  echo "[INFO] cloudflared 未安装，本地 Wi-Fi 模式不受影响"
fi

exit "$failed"
