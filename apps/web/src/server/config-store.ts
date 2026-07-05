import { execFile, spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_RUNTIME_CONFIG,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import {
  buildRuntimeConfig,
  generateReleaseSigningKeyPair,
  type RuntimeOnboardingInput,
} from "@aripabot/core/config/onboarding.ts";
import {
  installAutoUpdateCron,
  removeAutoUpdateCron,
} from "@aripabot/core/update/release-updater.ts";

import type {
  CompleteOnboardingResponse,
  ConfigResponse,
  GenerateSigningKeyResponse,
  SaveConfigResponse,
} from "@/lib/api-types";
import { requestBotRuntimeConfigReload } from "@/server/bot-runtime-control";
import { getEnv } from "@/server/env";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const defaultConfigPath = join(repositoryRoot, "config.json");
const execFileAsync = promisify(execFile);

export function resolveConfigPath(): string | URL {
  return getEnv("CONFIG_PATH")?.trim() || defaultConfigPath;
}

export async function readConfig(): Promise<ConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const existing = await readExistingJsonObject(pathOrUrl);
  const config = parseRuntimeJsonConfig(existing ?? DEFAULT_RUNTIME_CONFIG);

  return {
    path: formatPath(pathOrUrl),
    exists: existing !== null,
    raw: (existing ?? DEFAULT_RUNTIME_CONFIG) as Record<string, unknown>,
    config,
  };
}

export async function saveConfig(config: RuntimeJsonConfig): Promise<SaveConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const existing = await readExistingJsonObject(pathOrUrl);
  const savedConfig = parseRuntimeJsonConfig({ ...existing, ...config });
  const rawConfig = { ...existing, ...savedConfig };

  await writeFile(pathOrUrl, `${JSON.stringify(rawConfig, null, 2)}\n`);
  await requestBotRuntimeConfigReload();

  return {
    path: formatPath(pathOrUrl),
    exists: true,
    raw: rawConfig,
    config: savedConfig,
    savedAt: new Date().toISOString(),
  };
}

export async function completeOnboarding(
  input: RuntimeOnboardingInput,
): Promise<CompleteOnboardingResponse> {
  const pathOrUrl = resolveConfigPath();
  const existingConfig = await readExistingJsonObject(pathOrUrl);

  if (existingConfig) {
    throw new Error(`${formatPath(pathOrUrl)} already exists.`);
  }

  const rawConfig = buildRuntimeConfig(input);
  await writeFile(pathOrUrl, `${JSON.stringify(rawConfig, null, 2)}\n`);
  const config = parseRuntimeJsonConfig(rawConfig);
  const cronMessage = await syncAutoUpdateCron(config, pathOrUrl);

  return {
    path: formatPath(pathOrUrl),
    exists: true,
    raw: rawConfig,
    config,
    savedAt: new Date().toISOString(),
    cronMessage,
    updates: config.updates,
  };
}

export function createReleaseSigningKeyPair(): GenerateSigningKeyResponse {
  return generateReleaseSigningKeyPair();
}

async function syncAutoUpdateCron(
  config: RuntimeJsonConfig,
  configPath: string | URL,
): Promise<string> {
  if (!config.updates.enabled || !config.updates.autoInstall.enabled) {
    await removeAutoUpdateCron({
      crontabRead: readUserCrontab,
      crontabWrite: writeUserCrontab,
    });
    return "Automatic update cron is disabled.";
  }

  await installAutoUpdateCron({
    cwd: repositoryRoot,
    configPath,
    cronExpression: config.updates.autoInstall.cronExpression,
    crontabRead: readUserCrontab,
    crontabWrite: writeUserCrontab,
  });
  return `Automatic update cron installed for ${config.updates.autoInstall.cronExpression}.`;
}

async function readUserCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"]);
    return stdout;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";

    if (/no crontab/i.test(stderr)) {
      return "";
    }

    throw error;
  }
}

async function writeUserCrontab(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const subprocess = spawn("crontab", ["-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    subprocess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    subprocess.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    subprocess.on("error", reject);
    subprocess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      const output = [...stderrChunks, ...stdoutChunks]
        .map((chunk) => chunk.toString("utf8").trim())
        .filter(Boolean)
        .join("\n");
      reject(new Error(output || `crontab update failed with exit code ${exitCode}.`));
    });
    subprocess.stdin.write(content);
    subprocess.stdin.end();
  });
}

function formatPath(pathOrUrl: string | URL): string {
  return pathOrUrl instanceof URL ? pathOrUrl.pathname : pathOrUrl;
}

async function readExistingJsonObject(
  pathOrUrl: string | URL,
): Promise<Record<string, unknown> | null> {
  try {
    await access(pathOrUrl);
  } catch {
    return null;
  }

  const rawConfig = JSON.parse(await readFile(pathOrUrl, "utf8")) as unknown;
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Existing config.json must contain a JSON object.");
  }

  return rawConfig as Record<string, unknown>;
}
