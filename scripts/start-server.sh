#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先运行 scripts/setup-local.sh" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  pnpm build
fi
mkdir -p runtime
exec pnpm start

