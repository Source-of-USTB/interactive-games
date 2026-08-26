#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

scripts/preflight.sh
public_origin_override="${PUBLIC_ORIGIN:-}"
set -a
source .env
set +a
if [[ -n "$public_origin_override" ]]; then
  export PUBLIC_ORIGIN="$public_origin_override"
fi

if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  pnpm build
fi
mkdir -p runtime
pnpm start &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _attempt in {1..40}; do
  if curl --noproxy '*' --silent --fail "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

if ! curl --noproxy '*' --silent --fail "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
  echo "游戏服务未能在 10 秒内就绪" >&2
  exit 1
fi

if [[ "${PUBLIC_HEALTHCHECK:-false}" == "true" ]]; then
  public_check_origin="${PUBLIC_HEALTHCHECK_ORIGIN:-$PUBLIC_ORIGIN}"
  echo "正在验证玩家链路：${public_check_origin}"
  if [[ "$public_check_origin" != "$PUBLIC_ORIGIN" ]]; then
    echo "当前网络禁止本机回访公网随机域名；公网地址 ${PUBLIC_ORIGIN} 将由手机流量最终确认。"
  fi
  public_check_log="$project_dir/runtime/public-check.log"
  : >"$public_check_log"
  public_ready=false
  for _attempt in {1..20}; do
    if node scripts/check-public.mjs "$public_check_origin" >"$public_check_log" 2>&1; then
      public_ready=true
      break
    fi
    sleep 1
  done

  if [[ "$public_ready" != "true" ]]; then
    echo "公网入口已生成，但玩家全链路验证失败，本次不会展示无效二维码。" >&2
    echo "检查结果：" >&2
    tail -n 20 "$public_check_log" >&2
    echo "请运行对应的 diagnose-*-public.sh 查看隧道状态。" >&2
    exit 1
  fi
  if [[ "$public_check_origin" == "$PUBLIC_ORIGIN" ]]; then
    echo "公网入口已验证可用（HTTP + 玩家会话 + Bootstrap + WebSocket）。"
  else
    echo "玩家网关已验证可用（HTTP + 玩家会话 + Bootstrap + WebSocket）。"
  fi
fi

export GAME_SERVER_WS="ws://127.0.0.1:${PORT:-3000}/ws"
echo "管理端：http://127.0.0.1:${PORT:-3000}/admin"
echo "大屏正在启动，按 F11 可切换全屏。"
set +e
godot --path apps/godot --fullscreen
godot_status=$?
set -e

if [[ "${KEEP_SERVER_AFTER_GODOT:-false}" == "true" ]]; then
  echo "Godot 已退出（退出码 ${godot_status}），报名页和公网隧道仍保持运行。"
  echo "请保持本终端打开；按 Ctrl+C 才会停止服务。"
  wait "$server_pid" || true
else
  exit "$godot_status"
fi
