#!/usr/bin/env sh
set -eu

dashboard_port="${ARIPA_WEB_DASHBOARD_PORT:-57262}"
export DASHBOARD_AUTH_PATH="${DASHBOARD_AUTH_PATH:-/app/data/.aripa-dashboard-auth.json}"
export ARIPA_DOCKER_RUNTIME=1
runtime_log_path="${ARIPA_DOCKER_LOG_PATH:-/app/data/aripa-docker.log}"
export ARIPA_DOCKER_LOG_PATH="$runtime_log_path"
bot_pid_path="${ARIPA_BOT_PID_PATH:-/app/data/aripa-bot.pid}"
bot_restart_path="${ARIPA_BOT_RESTART_PATH:-/app/data/restart-bot}"
export ARIPA_BOT_PID_PATH="$bot_pid_path"
export ARIPA_BOT_RESTART_PATH="$bot_restart_path"
bot_pid=""
dashboard_pid=""
tail_pid=""

cleanup() {
  trap - INT TERM
  if [ -n "$bot_pid" ]; then
    kill "$bot_pid" 2>/dev/null || true
    wait "$bot_pid" 2>/dev/null || true
  fi

  if [ -n "$dashboard_pid" ]; then
    kill "$dashboard_pid" 2>/dev/null || true
    wait "$dashboard_pid" 2>/dev/null || true
  fi

  if [ -n "$tail_pid" ]; then
    kill "$tail_pid" 2>/dev/null || true
    wait "$tail_pid" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

mkdir -p "$(dirname "$runtime_log_path")"
: > "$runtime_log_path"
rm -f "$bot_restart_path"

tail -n 0 -f "$runtime_log_path" &
tail_pid="$!"

start_bot() {
  bun run start >> "$runtime_log_path" 2>&1 &
  bot_pid="$!"
  printf "%s\n" "$bot_pid" > "$bot_pid_path"
}

start_bot

(
  cd apps/web
  bunx next start -H 0.0.0.0 -p "$dashboard_port"
) >> "$runtime_log_path" 2>&1 &
dashboard_pid="$!"

while :; do
  if ! kill -0 "$bot_pid" 2>/dev/null; then
    set +e
    wait "$bot_pid"
    exit_code="$?"
    if [ -f "$bot_restart_path" ]; then
      rm -f "$bot_restart_path"
      start_bot
      set -e
      continue
    fi
    cleanup
    exit "$exit_code"
  fi

  if ! kill -0 "$dashboard_pid" 2>/dev/null; then
    set +e
    wait "$dashboard_pid"
    exit_code="$?"
    cleanup
    exit "$exit_code"
  fi

  sleep 1
done
