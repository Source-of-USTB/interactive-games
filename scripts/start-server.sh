#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

source scripts/logging.sh
ensure_run_context "$project_dir"
run_log="$RUN_LOG_DIR/run.log"
start_run_logging "$run_log"

if [[ ! -f .env ]]; then
  echo "[ERROR] Missing .env. Run scripts/setup-local.sh first." >&2
  exit 1
fi

set -a
source .env
set +a

if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  run_interactive pnpm build
fi
mkdir -p runtime
exec pnpm start
