#!/usr/bin/env bash
set -e

run_docker() {
  if docker "$@"; then
    return 0
  fi

  sudo docker "$@"
}

run_docker build -t aripa .

run_docker rm -f aripabot-docker 2>/dev/null || true

dashboard_port="${ARIPA_WEB_DASHBOARD_PORT:-}"
if [[ -z "$dashboard_port" && -f .env ]]; then
  dashboard_port="$(grep -E '^[[:space:]]*ARIPA_WEB_DASHBOARD_PORT=' .env | tail -n 1 | sed -E 's/^[^=]*=//' | tr -d '\r')"
  dashboard_port="${dashboard_port%\"}"
  dashboard_port="${dashboard_port#\"}"
  dashboard_port="${dashboard_port%\'}"
  dashboard_port="${dashboard_port#\'}"
fi
dashboard_port="${dashboard_port:-57262}"

dashboard_auth_args=()
if [[ -f .aripa-dashboard-auth.json ]]; then
  dashboard_auth_args=(
    -e DASHBOARD_AUTH_PATH=/app/.aripa-dashboard-auth.json
    --mount type=bind,source="$PWD/.aripa-dashboard-auth.json",target=/app/.aripa-dashboard-auth.json,readonly
  )
fi

run_docker run -d --restart always --name aripabot-docker \
  --env-file .env \
  -e ARIPA_WEB_DASHBOARD_PORT="${dashboard_port}" \
  -p "${dashboard_port}:${dashboard_port}" \
  --mount type=bind,source="$PWD/config.json",target=/app/config.json \
  --mount type=volume,source=aripa-data,target=/app/data \
  "${dashboard_auth_args[@]}" \
  aripa

echo "--------------------------------"
echo "Deployed Aripa Docker container."
echo "Dashboard: http://localhost:${dashboard_port}"
echo "Run 'docker logs -f aripabot-docker' to view logs."
echo "--------------------------------"
