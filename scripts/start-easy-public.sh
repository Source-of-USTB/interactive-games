#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v ssh >/dev/null 2>&1; then
  echo "缺少 OpenSSH 客户端（ssh）" >&2
  exit 1
fi

mkdir -p runtime
tunnel_log="$project_dir/runtime/localhost-run.log"
gateway_log="$project_dir/runtime/player-gateway.log"
known_hosts="$project_dir/runtime/ssh-known-hosts"
: >"$tunnel_log"
: >"$gateway_log"

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
  if rg -q '"status":"ready"' "$gateway_log"; then
    gateway_ready=true
    break
  fi
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "玩家公网网关启动失败：" >&2
    tail -n 40 "$gateway_log" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "$gateway_ready" != "true" ]]; then
  echo "玩家公网网关未能在 3 秒内就绪。" >&2
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
    echo "[诊断] 到 localhost.run:22 的 SSH 链路被当前网络阻断。" >&2
    echo "[建议] 让电脑连接手机热点后重试。" >&2
  elif rg -qi 'permission denied' "$tunnel_log"; then
    echo "[诊断] localhost.run 拒绝了本次匿名隧道申请。" >&2
  fi
}

public_origin=""
for _attempt in {1..120}; do
  public_origin="$(extract_public_origin)"
  if [[ -n "$public_origin" ]]; then
    break
  fi
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "玩家公网网关在隧道建立前退出：" >&2
    tail -n 40 "$gateway_log" >&2
    exit 1
  fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "localhost.run 公网隧道启动失败：" >&2
    print_failure_hint
    tail -n 100 "$tunnel_log" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ -z "$public_origin" ]]; then
  echo "30 秒内未获得 localhost.run 公网地址。" >&2
  print_failure_hint
  tail -n 100 "$tunnel_log" >&2
  exit 1
fi

echo "临时公网入口：$public_origin"
echo "隧道日志：$tunnel_log"
echo "玩家公网网关：http://127.0.0.1:${gateway_port}（管理路由已隔离）"
echo "正在启动游戏并验证 HTTP、会话、Bootstrap 和 WebSocket……"
PUBLIC_ORIGIN="$public_origin" \
  PUBLIC_HEALTHCHECK=true \
  PUBLIC_HEALTHCHECK_ORIGIN="http://127.0.0.1:${gateway_port}" \
  KEEP_SERVER_AFTER_GODOT=true \
  scripts/start-local.sh
