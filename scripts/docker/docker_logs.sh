#!/usr/bin/env bash
set -e

run_docker() {
  if docker "$@"; then
    return 0
  fi

  sudo docker "$@"
}


run_docker logs -f aripabot-docker

