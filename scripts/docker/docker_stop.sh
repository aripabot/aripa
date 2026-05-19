#!/usr/bin/env bash
set -e

run_docker() {
  if docker "$@"; then
    return 0
  fi

  sudo docker "$@"
}


run_docker rm -f aripabot-docker 2>/dev/null || true

echo "--------------------------------"
echo "Stopped Aripa Docker container"
echo "--------------------------------"