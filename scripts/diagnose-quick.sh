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
tunnel_log="$project_dir/runtime/quick-tunnel.log"

echo "== 进程 =="
process_rows="$(pgrep -af '[c]loudflared.*tunnel|[n]ode dist/index\.js|[g]odot.*apps/godot' 2>/dev/null || true)"
if [[ -n "$process_rows" ]]; then
  echo "$process_rows"
else
  echo "未发现 Quick Tunnel、游戏服务或 Godot 进程。"
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
echo "== Quick Tunnel 日志 =="
if [[ -f "$tunnel_log" ]]; then
  public_origin="$(
    rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$tunnel_log" \
      | rg -v '^https://api\.trycloudflare\.com$' \
      | head -n 1 \
      || true
  )"
  if [[ -n "$public_origin" ]]; then
    echo "最近生成的地址：$public_origin"
  elif rg -q 'api\.trycloudflare\.com.*connection reset by peer|connection reset by peer' "$tunnel_log"; then
    echo "状态：隧道申请失败，没有生成可供手机访问的公网地址。"
    echo "原因：到 api.trycloudflare.com:443 的连接被网络链路或对端重置。"
    echo "建议：把电脑切换到手机热点后，重新运行 ./scripts/start-quick-public.sh。"
  else
    echo "日志中没有找到有效的随机 trycloudflare.com 地址。"
  fi
  echo "日志文件：$tunnel_log"
  tail -n 80 "$tunnel_log"
else
  echo "未找到 $tunnel_log，说明新版 Quick 脚本尚未运行。"
fi
