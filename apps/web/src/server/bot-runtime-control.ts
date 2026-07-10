import { readFile, rm, writeFile } from "node:fs/promises";

import { getBotPidPath, getBotRestartPath, isInsideDockerRuntime } from "@/server/docker-runtime";

interface BotRuntimeControlDependencies {
  isInsideDocker?: () => boolean;
  readPid?: () => Promise<string>;
  writeRestartMarker?: () => Promise<void>;
  removeRestartMarker?: () => Promise<void>;
  signalProcess?: (pid: number) => void;
}

export async function requestBotRuntimeConfigReload(
  dependencies: BotRuntimeControlDependencies = {},
): Promise<void> {
  if (!(dependencies.isInsideDocker ?? isInsideDockerRuntime)()) {
    return;
  }

  const readPid = dependencies.readPid ?? (() => readFile(getBotPidPath(), "utf8"));
  const writeRestartMarker =
    dependencies.writeRestartMarker ??
    (() => writeFile(getBotRestartPath(), `${new Date().toISOString()}\n`));
  const removeRestartMarker =
    dependencies.removeRestartMarker ?? (() => rm(getBotRestartPath(), { force: true }));
  const signalProcess = dependencies.signalProcess ?? ((pid) => process.kill(pid, "SIGTERM"));

  const pid = Number((await readPid()).trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Bot process id is unavailable.");
  }

  await writeRestartMarker();

  try {
    signalProcess(pid);
  } catch (error) {
    await removeRestartMarker();
    throw error;
  }
}
