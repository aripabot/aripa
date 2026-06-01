import { readFile, writeFile } from "node:fs/promises";

import { getBotPidPath, getBotRestartPath, isInsideDockerRuntime } from "@/server/docker-runtime";

export async function requestBotRuntimeConfigReload(): Promise<void> {
  if (!isInsideDockerRuntime()) {
    return;
  }

  await writeFile(getBotRestartPath(), `${new Date().toISOString()}\n`);

  const pid = Number((await readFile(getBotPidPath(), "utf8")).trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Bot process id is unavailable.");
  }

  process.kill(pid, "SIGTERM");
}
