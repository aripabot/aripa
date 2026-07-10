import { access, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  DEFAULT_RUNTIME_CONFIG,
  parseRuntimeJsonConfig,
  parseRuntimeJsonConfigForMutation,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import { ConfigMutationCoordinator } from "@aripabot/core/config/config-mutation-coordinator.ts";
import {
  buildRuntimeConfig,
  generateReleaseSigningKeyPair,
  type RuntimeOnboardingInput,
} from "@aripabot/core/config/onboarding.ts";
import {
  installAutoUpdateCron,
  readUserCrontab,
  removeAutoUpdateCron,
  writeUserCrontab,
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
const configMutationCoordinator = new ConfigMutationCoordinator();

interface ConfigStoreDependencies {
  readCrontab?: () => Promise<string>;
  writeCrontab?: (content: string) => Promise<void>;
  requestReload?: () => Promise<void>;
}

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

export async function saveConfig(
  config: RuntimeJsonConfig,
  dependencies: ConfigStoreDependencies = {},
): Promise<SaveConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  return configMutationCoordinator.run(async () => {
    const existing = await readExistingJsonObject(pathOrUrl);
    const savedConfig = parseRuntimeJsonConfigForMutation(config);
    const rawConfig = { ...existing, ...savedConfig };
    await persistConfigMutation({ pathOrUrl, rawConfig, config: savedConfig, dependencies });

    return {
      path: formatPath(pathOrUrl),
      exists: true,
      raw: rawConfig,
      config: savedConfig,
      savedAt: new Date().toISOString(),
    };
  });
}

export async function completeOnboarding(
  input: RuntimeOnboardingInput,
  dependencies: ConfigStoreDependencies = {},
): Promise<CompleteOnboardingResponse> {
  const pathOrUrl = resolveConfigPath();
  return configMutationCoordinator.run(async () => {
    const existingConfig = await readExistingJsonObject(pathOrUrl);

    if (existingConfig) {
      throw new Error(`${formatPath(pathOrUrl)} already exists.`);
    }

    const rawConfig = buildRuntimeConfig(input);
    const config = parseRuntimeJsonConfigForMutation(rawConfig);
    const cronMessage = await persistConfigMutation({ pathOrUrl, rawConfig, config, dependencies });

    return {
      path: formatPath(pathOrUrl),
      exists: true,
      raw: rawConfig,
      config,
      savedAt: new Date().toISOString(),
      cronMessage,
      updates: config.updates,
    };
  });
}

export function createReleaseSigningKeyPair(): GenerateSigningKeyResponse {
  return generateReleaseSigningKeyPair();
}

async function syncAutoUpdateCron(
  config: RuntimeJsonConfig,
  configPath: string | URL,
  dependencies: ConfigStoreDependencies,
): Promise<string> {
  const readCrontab = dependencies.readCrontab ?? readUserCrontab;
  const writeCrontab = dependencies.writeCrontab ?? writeUserCrontab;

  if (!config.updates.enabled || !config.updates.autoInstall.enabled) {
    await removeAutoUpdateCron({
      crontabRead: readCrontab,
      crontabWrite: writeCrontab,
    });
    return "Automatic update cron is disabled.";
  }

  await installAutoUpdateCron({
    cwd: repositoryRoot,
    configPath,
    cronExpression: config.updates.autoInstall.cronExpression,
    crontabRead: readCrontab,
    crontabWrite: writeCrontab,
  });
  return `Automatic update cron installed for ${config.updates.autoInstall.cronExpression}.`;
}

async function persistConfigMutation(options: {
  pathOrUrl: string | URL;
  rawConfig: Record<string, unknown>;
  config: RuntimeJsonConfig;
  dependencies: ConfigStoreDependencies;
}): Promise<string> {
  const configSnapshot = await readFileIfPresent(options.pathOrUrl);
  const readCrontab = options.dependencies.readCrontab ?? readUserCrontab;
  const writeCrontab = options.dependencies.writeCrontab ?? writeUserCrontab;
  const crontabSnapshot = await readCrontab();

  try {
    await writeConfigAtomically(
      options.pathOrUrl,
      `${JSON.stringify(options.rawConfig, null, 2)}\n`,
    );
    const cronMessage = await syncAutoUpdateCron(options.config, options.pathOrUrl, {
      ...options.dependencies,
      readCrontab: async () => crontabSnapshot,
    });
    await (options.dependencies.requestReload ?? requestBotRuntimeConfigReload)();
    return cronMessage;
  } catch (error) {
    await restoreConfigSnapshot(options.pathOrUrl, configSnapshot);
    await writeCrontab(crontabSnapshot);
    throw error;
  }
}

async function writeConfigAtomically(pathOrUrl: string | URL, content: string): Promise<void> {
  const path = formatPath(pathOrUrl);
  const temporaryPath = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  const file = await open(temporaryPath, "w", 0o600);

  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(temporaryPath, path);
}

async function readFileIfPresent(pathOrUrl: string | URL): Promise<string | null> {
  try {
    return await readFile(pathOrUrl, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function restoreConfigSnapshot(
  pathOrUrl: string | URL,
  snapshot: string | null,
): Promise<void> {
  if (snapshot === null) {
    await rm(pathOrUrl, { force: true });
    return;
  }

  await writeConfigAtomically(pathOrUrl, snapshot);
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
