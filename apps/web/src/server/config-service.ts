import { stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  RUNTIME_MODEL_PROVIDERS,
  loadRuntimeJsonConfig,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/config.ts";
import { loadExistingRuntimeConfig } from "@aripabot/core/config/onboarding.ts";
import {
  loadStylePrompts,
  stylePromptDescription,
} from "@aripabot/core/onboarding-wizard/style-prompts.ts";
import {
  applyReleaseUpdate,
  fetchGitHubReleases,
  type GitHubRelease,
} from "@aripabot/core/update/release-updater.ts";

import type {
  ConfigResponse,
  DashboardStatus,
  LocalLogFile,
  LogsResponse,
  ReleasesResponse,
  SaveConfigResponse,
  StylePromptOption,
  UpdateInstallResponse,
} from "@/lib/api-types";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const defaultConfigUrl = new URL("../../../../config.json", import.meta.url);
const packageJsonUrl = new URL("../../../../package.json", import.meta.url);
const webPackageJsonUrl = new URL("../../package.json", import.meta.url);

export function resolveConfigPath(): string | URL {
  return Bun.env.CONFIG_PATH?.trim() || defaultConfigUrl;
}

export async function readConfig(): Promise<ConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const existing = await loadExistingRuntimeConfig(pathOrUrl);
  const config = existing
    ? parseRuntimeJsonConfig(existing)
    : await loadRuntimeJsonConfig(pathOrUrl);

  return {
    path: formatPath(pathOrUrl),
    raw: (existing ?? DEFAULT_RUNTIME_CONFIG) as Record<string, unknown>,
    config,
  };
}

export async function saveConfig(config: RuntimeJsonConfig): Promise<SaveConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const parsedConfig = parseRuntimeJsonConfig(config);
  const existing = await loadExistingRuntimeConfig(pathOrUrl);
  const mergedConfig = { ...existing, ...parsedConfig };

  await Bun.write(pathOrUrl, `${JSON.stringify(mergedConfig, null, 2)}\n`);

  return {
    path: formatPath(pathOrUrl),
    raw: mergedConfig,
    config: parseRuntimeJsonConfig(mergedConfig),
    savedAt: new Date().toISOString(),
  };
}

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const [configResponse, styles, botPackageJson, webPackageJson] = await Promise.all([
    readConfig(),
    getStylePromptOptions(),
    readJson<{ version?: string }>(packageJsonUrl),
    readJson<{ version?: string }>(webPackageJsonUrl),
  ]);

  return {
    appName: configResponse.config.name,
    botVersion: botPackageJson.version ?? "unknown",
    webVersion: webPackageJson.version ?? "unknown",
    configPath: configResponse.path,
    databasePath: Bun.env.DATABASE_PATH?.trim() || "aripa.sqlite",
    tokenConfigured: Boolean(Bun.env.TOKEN?.trim()),
    prefix: Bun.env.PREFIX?.trim() || "-",
    styles,
    providers: [...RUNTIME_MODEL_PROVIDERS],
    reasoningEfforts: [...REASONING_EFFORTS],
    config: configResponse.config,
  };
}

export async function readLocalLogs(): Promise<LogsResponse> {
  const candidates = [
    join(repositoryRoot, "aripa.log"),
    join(repositoryRoot, "aripa-update.log"),
    join(repositoryRoot, "apps", "bot", "aripa.log"),
    join(repositoryRoot, "apps", "bot", "aripa-update.log"),
  ];

  const files = await Promise.all(candidates.map(readLogCandidate));
  return { files };
}

export async function listReleases(): Promise<ReleasesResponse> {
  const { config } = await readConfig();
  const repo = config.updates.githubRepo;
  const releases = config.updates.enabled
    ? await fetchGitHubReleases({ repo, token: Bun.env.GITHUB_TOKEN?.trim() || null })
    : [];

  return { repo, releases };
}

export async function installRelease(tagName: string): Promise<UpdateInstallResponse> {
  const { config } = await readConfig();
  if (!config.updates.enabled) {
    throw new Error("Updates are disabled.");
  }

  const releases = await fetchGitHubReleases({
    repo: config.updates.githubRepo,
    token: Bun.env.GITHUB_TOKEN?.trim() || null,
  });
  const release = releases.find((candidate) => candidate.tagName === tagName);
  if (!release) {
    throw new Error(`Release ${tagName} was not found.`);
  }

  const progress: string[] = [];
  const result = await applyReleaseUpdate({
    cwd: repositoryRoot,
    release,
    token: Bun.env.GITHUB_TOKEN?.trim() || null,
    installDependencies: true,
    releasePublicKeyPem: config.updates.releasePublicKeyPem,
    releasePublicKeyPemBase64: config.updates.releasePublicKeyPemBase64,
    onProgress: (message) => {
      progress.push(message);
    },
  });

  return {
    tagName,
    updatedPath: result.updatedPath,
    installedDependencies: result.installedDependencies,
    progress,
  };
}

async function getStylePromptOptions(): Promise<StylePromptOption[]> {
  const { config } = await readConfig();
  const styles = await loadStylePrompts(config.stylePrompt);
  return styles.map((style) => ({
    value: style,
    label: toTitleCase(style),
    description: stylePromptDescription(style),
  }));
}

async function readLogCandidate(path: string): Promise<LocalLogFile> {
  const name = path.replace(`${repositoryRoot}/`, "");

  try {
    const metadata = await stat(path);
    const text = await Bun.file(path).text();
    const lines = text.split(/\r?\n/).filter(Boolean).slice(-150);

    return {
      name,
      path,
      exists: true,
      updatedAt: metadata.mtime.toISOString(),
      sizeBytes: metadata.size,
      lines,
    };
  } catch {
    return {
      name,
      path,
      exists: false,
      updatedAt: null,
      sizeBytes: 0,
      lines: [],
    };
  }
}

async function readJson<T>(pathOrUrl: string | URL): Promise<T> {
  return (await Bun.file(pathOrUrl).json()) as T;
}

function formatPath(pathOrUrl: string | URL): string {
  return pathOrUrl instanceof URL ? pathOrUrl.pathname : pathOrUrl;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function staticFilePath(pathname: string): string {
  const staticDir = Bun.env.WEB_STATIC_DIR?.trim();
  return staticDir ? join(appRoot, staticDir, pathname) : "";
}

export function latestReleaseTag(releases: readonly GitHubRelease[]): string | null {
  return releases[0]?.tagName ?? null;
}
