import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_RUNTIME_CONFIG, REASONING_EFFORTS } from "@aripabot/core/config/runtime-config.ts";
import { loadWizardModelOptions } from "@aripabot/core/onboarding-wizard/model-options.ts";
import { getSelectableModelProviders } from "@aripabot/core/onboarding-wizard/provider-availability.ts";
import {
  loadStylePrompts,
  stylePromptDescription,
} from "@aripabot/core/onboarding-wizard/style-prompts.ts";
import { AUTO_UPDATE_CRON_PRESETS } from "@aripabot/core/update/auto-update-cron.ts";

import type {
  DashboardStatus,
  OnboardingOptionsResponse,
  StylePromptOption,
} from "@/lib/api-types";
import { readConfig } from "@/server/config-store";
import { getEnv } from "@/server/env";
import {
  getBotRuntimeStatus,
  getDashboardOperations,
  resolveDatabasePath,
} from "@/server/operations";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const packageJsonPath = join(repositoryRoot, "package.json");
const webPackageJsonPath = join(appRoot, "package.json");

export async function getOnboardingOptions(): Promise<OnboardingOptionsResponse> {
  const configResponse = await readConfig();
  const [styles, modelOptions] = await Promise.all([
    getStylePromptOptions(configResponse.config.stylePrompt),
    loadWizardModelOptions(),
  ]);

  return {
    configPath: configResponse.path,
    config: configResponse.config,
    styles,
    modelOptions,
    autoUpdateCronPresets: [...AUTO_UPDATE_CRON_PRESETS],
    defaultUpdateRepo: DEFAULT_RUNTIME_CONFIG.updates.githubRepo,
  };
}

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const configResponse = await readConfig();
  const [styles, botPackageJson, webPackageJson, botRuntime, providers, databasePath] =
    await Promise.all([
      getStylePromptOptions(configResponse.config.stylePrompt),
      readJson<{ version?: string }>(packageJsonPath),
      readJson<{ version?: string }>(webPackageJsonPath),
      getBotRuntimeStatus(),
      getSelectableModelProviders(),
      resolveDatabasePath(),
    ]);
  const operations = await getDashboardOperations(configResponse.config, databasePath);

  return {
    appName: configResponse.config.name,
    botVersion: botPackageJson.version ?? "unknown",
    webVersion: webPackageJson.version ?? "unknown",
    configPath: configResponse.path,
    configExists: configResponse.exists,
    databasePath,
    tokenConfigured: Boolean(getEnv("TOKEN")?.trim()),
    prefix: getEnv("PREFIX")?.trim() || "-",
    botRuntime,
    operations,
    styles,
    providers,
    reasoningEfforts: [...REASONING_EFFORTS],
    config: configResponse.config,
  };
}

async function getStylePromptOptions(selectedStylePrompt: string): Promise<StylePromptOption[]> {
  const styles = await loadStylePrompts(selectedStylePrompt);

  return styles.map((style) => ({
    value: style,
    label: toTitleCase(style),
    description: stylePromptDescription(style),
  }));
}

async function readJson<T>(pathOrUrl: string | URL): Promise<T> {
  return JSON.parse(await readFile(pathOrUrl, "utf8")) as T;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
