import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  RUNTIME_MODEL_PROVIDERS,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import type { GitHubRelease } from "@aripabot/core/update/release-updater.ts";

import type {
  ConfigResponse,
  DashboardStatus,
  LocalLogFile,
  LogsResponse,
  ReleasesResponse,
  SaveConfigResponse,
  StylePromptOption,
} from "@/lib/api-types";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const defaultConfigPath = join(repositoryRoot, "config.json");
const packageJsonPath = join(repositoryRoot, "package.json");
const webPackageJsonPath = join(appRoot, "package.json");
const STYLE_PROMPTS = ["match", "concise", "formal", "friendly", "original", "playful"] as const;

export function resolveConfigPath(): string | URL {
  return process.env.CONFIG_PATH?.trim() || defaultConfigPath;
}

export async function readConfig(): Promise<ConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const existing = await readExistingJsonObject(pathOrUrl);
  const config = parseRuntimeJsonConfig(existing ?? DEFAULT_RUNTIME_CONFIG);

  return {
    path: formatPath(pathOrUrl),
    raw: (existing ?? DEFAULT_RUNTIME_CONFIG) as Record<string, unknown>,
    config,
  };
}

export async function saveConfig(config: RuntimeJsonConfig): Promise<SaveConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const parsedConfig = parseRuntimeJsonConfig(config);
  const existing = await readExistingJsonObject(pathOrUrl);
  const mergedConfig = { ...existing, ...parsedConfig };

  await writeFile(pathOrUrl, `${JSON.stringify(mergedConfig, null, 2)}\n`);

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
    readJson<{ version?: string }>(packageJsonPath),
    readJson<{ version?: string }>(webPackageJsonPath),
  ]);

  return {
    appName: configResponse.config.name,
    botVersion: botPackageJson.version ?? "unknown",
    webVersion: webPackageJson.version ?? "unknown",
    configPath: configResponse.path,
    databasePath: process.env.DATABASE_PATH?.trim() || "aripa.sqlite",
    tokenConfigured: Boolean(process.env.TOKEN?.trim()),
    prefix: process.env.PREFIX?.trim() || "-",
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
    ? await fetchGitHubReleases(repo, process.env.GITHUB_TOKEN?.trim() || null)
    : [];

  return { repo, releases };
}

async function getStylePromptOptions(): Promise<StylePromptOption[]> {
  const { config } = await readConfig();
  const styles: string[] = [...STYLE_PROMPTS];
  if (!styles.includes(config.stylePrompt)) {
    styles.push(config.stylePrompt);
  }

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
    const text = await readFile(path, "utf8");
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
  return JSON.parse(await readFile(pathOrUrl, "utf8")) as T;
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

function stylePromptDescription(stylePrompt: string): string {
  switch (stylePrompt) {
    case "match":
      return "Adapt to the conversation's tone.";
    case "friendly":
      return "Warm and approachable.";
    case "concise":
      return "Short, direct responses.";
    case "formal":
      return "Polished and restrained.";
    case "playful":
      return "Light, casual energy.";
    case "original":
      return "The base Aripa personality.";
    default:
      return "Custom prompt style.";
  }
}

export function latestReleaseTag(releases: readonly GitHubRelease[]): string | null {
  return releases[0]?.tagName ?? null;
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

async function fetchGitHubReleases(
  repo: string,
  token: string | null | undefined,
): Promise<GitHubRelease[]> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: githubHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as GitHubReleaseResponse[];
  return payload
    .filter((release) => !release.draft)
    .map(toGitHubRelease)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function toGitHubRelease(release: GitHubReleaseResponse): GitHubRelease {
  return {
    id: release.id,
    tagName: release.tag_name,
    name: release.name?.trim() || release.tag_name,
    prerelease: release.prerelease,
    draft: release.draft,
    publishedAt: release.published_at ?? release.created_at,
    tarballUrl: release.tarball_url,
    zipballUrl: release.zipball_url,
    htmlUrl: release.html_url,
    assets: (release.assets ?? []).map((asset) => ({
      name: asset.name,
      downloadUrl: asset.browser_download_url,
    })),
  };
}

function githubHeaders(token: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aripa-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

interface GitHubReleaseResponse {
  id: number;
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  created_at: string;
  tarball_url: string;
  zipball_url: string;
  html_url: string;
  assets?: GitHubReleaseAssetResponse[];
}

interface GitHubReleaseAssetResponse {
  name: string;
  browser_download_url: string;
}
