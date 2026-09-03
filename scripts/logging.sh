#!/usr/bin/env bash

ensure_run_context() {
  local project_dir="$1"
  export RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
  export RUN_LOG_DIR="${RUN_LOG_DIR:-$project_dir/runtime/logs/$RUN_ID}"
  mkdir -p "$RUN_LOG_DIR"
}

run_interactive() {
  if ! command -v script >/dev/null 2>&1; then
    echo "[ERROR] The 'script' command is required for interactive pnpm commands." >&2
    return 127
  fi
  local command_text
  local -a command_args=("$@")
  printf -v command_text '%q ' "${command_args[@]}"
  script -qefc "${command_text% }" /dev/null
}

normalize_output() {
  perl -pe 'BEGIN { $| = 1 } s/\e\[[0-?]*[ -\/]*[@-~]//g; s/\r\n/\n/g; s/\r/\n/g'
}

colorize_output() {
  awk '
    /(^| )\[INFO\]/ { printf "\033[36m%s\033[0m\n", $0; fflush(); next }
    /(^| )\[WARN\]/ { printf "\033[33m%s\033[0m\n", $0; fflush(); next }
    /(^| )\[(ERROR|FAIL)\]/ { printf "\033[31m%s\033[0m\n", $0; fflush(); next }
    /(^| )\[OK\]/ { printf "\033[32m%s\033[0m\n", $0; fflush(); next }
    /(^| )\[HINT\]/ { printf "\033[35m%s\033[0m\n", $0; fflush(); next }
    { print; fflush() }
  '
}

start_run_logging() {
  local log_file="$1"
  if [[ "${RUN_LOG_ACTIVE:-false}" == "true" ]]; then
    return 0
  fi
  : >>"$log_file"
  export RUN_LOG_ACTIVE=true
  exec > >(tee >(normalize_output >>"$log_file") | colorize_output) 2>&1
}

process_is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$state" && "$state" != Z* ]]
}
