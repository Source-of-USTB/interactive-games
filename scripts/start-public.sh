#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "缺少 cloudflared；请按 docs/现场运行手册.md 完成公网隧道配置。" >&2
  exit 1
fi
if [[ ! -f deploy/cloudflared.yml ]]; then
  echo "缺少 deploy/cloudflared.yml，请从示例复制并填写 tunnel UUID 与域名。" >&2
  exit 1
fi

cloudflared tunnel --config deploy/cloudflared.yml run &
tunnel_pid=$!
cleanup_tunnel() {
  kill "$tunnel_pid" 2>/dev/null || true
  wait "$tunnel_pid" 2>/dev/null || true
}
trap cleanup_tunnel EXIT INT TERM
scripts/start-local.sh

