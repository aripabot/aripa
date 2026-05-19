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

run_docker run -d --restart always --name aripabot-docker \
  --env-file .env \
  --mount type=bind,source="$PWD/config.json",target=/app/config.json,readonly \
  --mount type=volume,source=aripa-data,target=/app/data \
  aripa

echo "--------------------------------"
echo "Deployed Aripa Docker container."
echo "Run 'docker logs -f aripabot-docker' to view logs."
echo "--------------------------------"

