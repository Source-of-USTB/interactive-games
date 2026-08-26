#!/usr/bin/env bash
set -u

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

port="${PORT:-}"
if [[ -f .env ]]; then
  configured_port="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
  port="${configured_port:-$port}"
fi
port="${port:-3000}"
tunnel_log="$project_dir/runtime/localhost-run.log"

echo "== 进程 =="
process_rows="$(pgrep -af '[s]sh.*localhost\.run|[n]ode dist/index\.js|[n]ode scripts/player-gateway\.mjs|[g]odot.*apps/godot' 2>/dev/null || true)"
if [[ -n "$process_rows" ]]; then
  echo "$process_rows"
else
  echo "未发现 localhost.run、游戏服务或 Godot 进程。"
fi

echo
echo "== 玩家公网网关 =="
if curl --noproxy '*' --silent --show-error --fail --max-time 3 "http://127.0.0.1:3100/api/health"; then
  echo
  echo "玩家网关可访问，只转发报名和投票所需路由。"
else
  echo "玩家网关无法访问。"
fi

echo
echo "== 本机服务 =="
if curl --noproxy '*' --silent --show-error --fail --max-time 3 "http://127.0.0.1:${port}/api/health"; then
  echo
  echo "本机 ${port} 端口正常。"
else
  echo "本机 ${port} 端口无法访问。"
fi

echo
echo "== localhost.run 日志 =="
if [[ -f "$tunnel_log" ]]; then
  public_origin="$(
    rg -o 'https://[A-Za-z0-9][A-Za-z0-9.-]*\.lhr\.life' "$tunnel_log" \
      | head -n 1 \
      || true
  )"
  if [[ -n "$public_origin" ]]; then
    echo "最近生成的地址：$public_origin"
  elif rg -qi 'connection timed out|operation timed out|connection refused|connection reset' "$tunnel_log"; then
    echo "状态：到 localhost.run:22 的 SSH 链路被当前网络阻断。"
    echo "建议：让电脑连接手机热点后重试。"
  else
    echo "日志中没有找到有效的公网地址。"
  fi
  echo "日志文件：$tunnel_log"
  tail -n 100 "$tunnel_log"
else
  echo "未找到 $tunnel_log，说明便捷公网脚本尚未运行。"
fi
