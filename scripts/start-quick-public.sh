#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "缺少 cloudflared" >&2
  exit 1
fi

mkdir -p runtime
tunnel_log="$project_dir/runtime/quick-tunnel.log"
: >"$tunnel_log"
cloudflared tunnel \
  --no-autoupdate \
  --edge-ip-version 4 \
  --protocol http2 \
  --url http://127.0.0.1:3000 >"$tunnel_log" 2>&1 &
tunnel_pid=$!
cleanup_tunnel() {
  kill "$tunnel_pid" 2>/dev/null || true
  wait "$tunnel_pid" 2>/dev/null || true
}
trap cleanup_tunnel EXIT INT TERM

extract_public_origin() {
  rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" \
    | rg -v '^https://api\.trycloudflare\.com$' \
    | head -n 1 \
    || true
}

print_failure_hint() {
  if rg -q 'api\.trycloudflare\.com.*connection reset by peer|connection reset by peer' "$tunnel_log"; then
    echo "[诊断] Quick Tunnel 尚未创建：到 api.trycloudflare.com:443 的连接被网络链路或对端重置。" >&2
    echo "[建议] 先把电脑切换到手机热点后重试；这不是游戏后端或二维码页面故障。" >&2
  fi
}

public_origin=""
for _attempt in {1..80}; do
  public_origin="$(extract_public_origin)"
  if [[ -n "$public_origin" ]]; then
    break
  fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "快速公网隧道启动失败：" >&2
    print_failure_hint
    sed -n '1,120p' "$tunnel_log" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ -z "$public_origin" ]]; then
  echo "20 秒内未获得快速隧道地址" >&2
  echo "详细日志：$tunnel_log" >&2
  print_failure_hint
  tail -n 80 "$tunnel_log" >&2
  exit 1
fi

echo "临时公网入口：$public_origin"
echo "该地址仅用于彩排，每次启动都会变化。"
echo "隧道日志：$tunnel_log"
PUBLIC_ORIGIN="$public_origin" \
  PUBLIC_HEALTHCHECK=true \
  KEEP_SERVER_AFTER_GODOT=true \
  scripts/start-local.sh
