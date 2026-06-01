import { existsSync } from "node:fs";

export const DOCKER_CONTAINER_NAME = "aripabot-docker";
export const HOST_DOCKER_SOURCE_ID = `docker:${DOCKER_CONTAINER_NAME}`;
export const CURRENT_DOCKER_SOURCE_ID = "docker:current";
export const DEFAULT_DOCKER_RUNTIME_LOG_PATH = "/app/data/aripa-docker.log";
export const DEFAULT_BOT_PID_PATH = "/app/data/aripa-bot.pid";
export const DEFAULT_BOT_RESTART_PATH = "/app/data/restart-bot";

export function isInsideDockerRuntime(): boolean {
  return process.env.ARIPA_DOCKER_RUNTIME === "1" || existsSync("/.dockerenv");
}

export function getDockerRuntimeLogPath(): string {
  return process.env.ARIPA_DOCKER_LOG_PATH?.trim() || DEFAULT_DOCKER_RUNTIME_LOG_PATH;
}

export function getBotPidPath(): string {
  return process.env.ARIPA_BOT_PID_PATH?.trim() || DEFAULT_BOT_PID_PATH;
}

export function getBotRestartPath(): string {
  return process.env.ARIPA_BOT_RESTART_PATH?.trim() || DEFAULT_BOT_RESTART_PATH;
}
