import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  RUNTIME_MODEL_PROVIDERS,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import type { GitHubRelease } from "@aripabot/core/update/release-updater.ts";

import type {
  ActiveMuteSummary,
  AttentionItem,
  BotRuntimeStatus,
  ConfigResponse,
  DashboardStatus,
  DashboardOperations,
  DiscordLookupStatus,
  GuildOperationsSummary,
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
const rootEnv = readRootEnv();
const STYLE_PROMPTS = ["match", "concise", "formal", "friendly", "original", "playful"] as const;
const execFileAsync = promisify(execFile);

function getEnv(name: string): string | undefined {
  return process.env[name] ?? rootEnv[name];
}

function readRootEnv(): Record<string, string> {
  try {
    return parseEnvText(readFileSync(join(repositoryRoot, ".env"), "utf8"));
  } catch {
    return {};
  }
}

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    values[key] = unquoteEnvValue(rawValue);
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
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
  const [configResponse, styles, botPackageJson, webPackageJson, botRuntime] = await Promise.all([
    readConfig(),
    getStylePromptOptions(),
    readJson<{ version?: string }>(packageJsonPath),
    readJson<{ version?: string }>(webPackageJsonPath),
    getBotRuntimeStatus(),
  ]);
  const databasePath = await resolveDatabasePath();
  const operations = await getDashboardOperations(configResponse.config, databasePath);

  return {
    appName: configResponse.config.name,
    botVersion: botPackageJson.version ?? "unknown",
    webVersion: webPackageJson.version ?? "unknown",
    configPath: configResponse.path,
    databasePath,
    tokenConfigured: Boolean(getEnv("TOKEN")?.trim()),
    prefix: getEnv("PREFIX")?.trim() || "-",
    botRuntime,
    operations,
    styles,
    providers: [...RUNTIME_MODEL_PROVIDERS],
    reasoningEfforts: [...REASONING_EFFORTS],
    config: configResponse.config,
  };
}

async function getDashboardOperations(
  config: RuntimeJsonConfig,
  databasePath: string,
): Promise<DashboardOperations> {
  const localState = await readLocalOperations(databasePath);
  const guildConfigs = localState.guildConfigs;
  const tags = localState.tags;
  const activeMutes = localState.activeMutes;
  const guildIds = [
    ...new Set([
      ...config.allowlistedServerIds,
      ...guildConfigs.map((guildConfig) => guildConfig.guildId),
      ...activeMutes.map((mute) => mute.guildId),
      ...tags.map((tag) => tag.guildId),
    ]),
  ].sort();
  const discord = await getDiscordDirectory(guildIds, activeMutes);
  const tagCountByGuild = countBy(tags, (tag) => tag.guildId);
  const activeMuteCountByGuild = countBy(activeMutes, (mute) => mute.guildId);
  const configByGuild = new Map(
    guildConfigs.map((guildConfig) => [guildConfig.guildId, guildConfig]),
  );
  const guilds = guildIds.map((guildId): GuildOperationsSummary => {
    const guildConfig = configByGuild.get(guildId);
    const guild = discord.guilds.get(guildId);
    const logChannel = guildConfig?.logChannelId
      ? discord.channels.get(channelKey(guildId, guildConfig.logChannelId))
      : null;
    const muteRole = guildConfig?.muteRoleId
      ? discord.roles.get(roleKey(guildId, guildConfig.muteRoleId))
      : null;
    const tagCount = tagCountByGuild.get(guildId) ?? 0;
    const activeMuteCount = activeMuteCountByGuild.get(guildId) ?? 0;
    const muteMode = guildConfig?.muteMode ?? "none";
    const modLogsEnabled = guildConfig?.modLogsEnabled ?? false;
    const readiness = getGuildReadiness({
      modLogsEnabled,
      logChannelId: guildConfig?.logChannelId ?? null,
      muteMode,
      muteRoleId: guildConfig?.muteRoleId ?? null,
      tagCount,
      activeMuteCount,
    });

    return {
      guildId,
      name: guild?.name ?? null,
      iconUrl: guild?.iconUrl ?? null,
      logChannelId: guildConfig?.logChannelId ?? null,
      logChannelName: logChannel?.name ?? null,
      modLogsEnabled,
      banMessage: guildConfig?.banMessage ?? null,
      muteRoleId: guildConfig?.muteRoleId ?? null,
      muteRoleName: muteRole?.name ?? null,
      muteMode,
      tagCount,
      activeMuteCount,
      updatedAt: guildConfig?.updatedAt ?? null,
      readiness,
    };
  });
  const muteSummaries = activeMutes
    .map((mute): ActiveMuteSummary => {
      const guild = discord.guilds.get(mute.guildId);
      const member = discord.members.get(memberKey(mute.guildId, mute.userId));
      const role = discord.roles.get(roleKey(mute.guildId, mute.muteRoleId));
      const expiresAtMs = mute.expiresAt ? Date.parse(mute.expiresAt) : null;
      const status =
        expiresAtMs === null
          ? "indefinite"
          : Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()
            ? "expired"
            : "active";

      return {
        guildId: mute.guildId,
        guildName: guild?.name ?? null,
        userId: mute.userId,
        username: member?.username ?? null,
        displayName: member?.displayName ?? null,
        avatarUrl: member?.avatarUrl ?? null,
        muteRoleId: mute.muteRoleId,
        muteRoleName: role?.name ?? null,
        expiresAt: mute.expiresAt,
        createdAt: mute.createdAt,
        status,
      };
    })
    .sort((a, b) => {
      if (a.status === "expired" && b.status !== "expired") {
        return -1;
      }
      if (b.status === "expired" && a.status !== "expired") {
        return 1;
      }
      return Date.parse(a.expiresAt ?? a.createdAt) - Date.parse(b.expiresAt ?? b.createdAt);
    });
  const attentionItems = buildAttentionItems(guilds, muteSummaries, discord.lookup);
  if (localState.error) {
    attentionItems.unshift({
      id: "local-database",
      severity: "warning",
      title: "Database Read Limited",
      detail: localState.error,
    });
  }
  const expiredMutes = muteSummaries.filter((mute) => mute.status === "expired").length;

  return {
    guilds,
    activeMutes: muteSummaries,
    attentionItems,
    totals: {
      guilds: guilds.length,
      readyGuilds: guilds.filter((guild) => guild.readiness === "ready").length,
      attentionGuilds: guilds.filter((guild) => guild.readiness === "attention").length,
      activeMutes: muteSummaries.length,
      expiredMutes,
      tags: tags.length,
    },
    discordLookup: discord.lookup,
  };
}

async function readLocalOperations(databasePath: string): Promise<LocalOperationsState> {
  const script = `
    import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
    import { ActiveMuteStore } from "@aripabot/core/moderation/active-mute-store.ts";

    const databasePath = process.env.ARIPA_DASHBOARD_DATABASE_PATH;
    const guildConfigStore = new GuildConfigStore(databasePath);
    const activeMuteStore = new ActiveMuteStore(databasePath);

    try {
      console.log(JSON.stringify({
        guildConfigs: guildConfigStore.listGuildConfigs(),
        tags: guildConfigStore.listAllTags(),
        activeMutes: activeMuteStore.listAll(),
      }));
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  `;

  try {
    const { stdout } = await execFileAsync("bun", ["--eval", script], {
      cwd: repositoryRoot,
      env: {
        ...rootEnv,
        ...process.env,
        ARIPA_DASHBOARD_DATABASE_PATH: databasePath,
        DATABASE_PATH: databasePath,
      },
      timeout: 5_000,
    });
    return JSON.parse(stdout) as LocalOperationsState;
  } catch (error) {
    return {
      guildConfigs: [],
      tags: [],
      activeMutes: [],
      error: readableError(error),
    };
  }
}

async function getBotRuntimeStatus(): Promise<BotRuntimeStatus> {
  if (await isDockerContainerRunning("aripabot-docker")) {
    return {
      state: "docker",
      label: "Running via Docker",
      detail: "Container aripabot-docker is active.",
    };
  }

  if (await isBotProcessRunning()) {
    return {
      state: "running",
      label: "Running",
      detail: "A local Aripa bot process is active.",
    };
  }

  return {
    state: "stopped",
    label: "Not Running",
    detail: "No local bot process or Docker container was found.",
  };
}

async function isDockerContainerRunning(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", containerName],
      { timeout: 1_500 },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isBotProcessRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "command="], { timeout: 1_500 });
    return stdout.split(/\r?\n/).some((line) => {
      if (!line.includes("src/index.ts")) {
        return false;
      }

      return (
        line.includes("apps/bot") ||
        line.includes("--cwd apps/bot") ||
        line.includes("--env-file=../../.env")
      );
    });
  } catch {
    return false;
  }
}

async function getDiscordDirectory(
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
): Promise<{
  lookup: DiscordLookupStatus;
  guilds: Map<string, DiscordGuildSummary>;
  channels: Map<string, DiscordNamedResource>;
  roles: Map<string, DiscordNamedResource>;
  members: Map<string, DiscordMemberSummary>;
}> {
  const token = getEnv("TOKEN")?.trim();
  const output = {
    lookup: {
      available: Boolean(token),
      detail: token
        ? "Discord names are loaded from the bot token."
        : "Set TOKEN to show server, channel, role, and member names.",
    },
    guilds: new Map<string, DiscordGuildSummary>(),
    channels: new Map<string, DiscordNamedResource>(),
    roles: new Map<string, DiscordNamedResource>(),
    members: new Map<string, DiscordMemberSummary>(),
  };

  if (!token) {
    return output;
  }

  try {
    await Promise.all(
      guildIds.map(async (guildId) => {
        const [guild, channels, roles] = await Promise.all([
          discordGet<DiscordGuildResponse>(`/guilds/${guildId}`, token),
          discordGet<DiscordChannelResponse[]>(`/guilds/${guildId}/channels`, token).catch(
            () => [],
          ),
          discordGet<DiscordRoleResponse[]>(`/guilds/${guildId}/roles`, token).catch(() => []),
        ]);

        output.guilds.set(guildId, {
          id: guild.id,
          name: guild.name,
          iconUrl: guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
            : null,
        });

        for (const channel of channels) {
          output.channels.set(channelKey(guildId, channel.id), {
            id: channel.id,
            name: channel.name,
          });
        }

        for (const role of roles) {
          output.roles.set(roleKey(guildId, role.id), { id: role.id, name: role.name });
        }
      }),
    );

    await Promise.all(
      activeMutes.map(async (mute) => {
        const member = await discordGet<DiscordMemberResponse>(
          `/guilds/${mute.guildId}/members/${mute.userId}`,
          token,
        ).catch(() => null);

        if (!member) {
          return;
        }

        const user = member.user;
        output.members.set(memberKey(mute.guildId, mute.userId), {
          userId: mute.userId,
          username: user?.global_name || user?.username || null,
          displayName: member.nick || user?.global_name || user?.username || null,
          avatarUrl: member.avatar
            ? `https://cdn.discordapp.com/guilds/${mute.guildId}/users/${mute.userId}/avatars/${member.avatar}.png?size=64`
            : user?.avatar
              ? `https://cdn.discordapp.com/avatars/${mute.userId}/${user.avatar}.png?size=64`
              : null,
        });
      }),
    );
  } catch (error) {
    output.lookup = {
      available: false,
      detail: readableError(error),
    };
  }

  return output;
}

async function discordGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "aripa-dashboard",
    },
  });

  if (!response.ok) {
    throw new Error(`Discord lookup failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function getGuildReadiness(options: {
  modLogsEnabled: boolean;
  logChannelId: string | null;
  muteMode: "none" | "role" | "timeout";
  muteRoleId: string | null;
  tagCount: number;
  activeMuteCount: number;
}): GuildOperationsSummary["readiness"] {
  if (
    (options.modLogsEnabled && !options.logChannelId) ||
    (options.muteMode === "role" && !options.muteRoleId)
  ) {
    return "attention";
  }

  if (
    options.modLogsEnabled ||
    options.muteMode !== "none" ||
    options.tagCount > 0 ||
    options.activeMuteCount > 0
  ) {
    return "ready";
  }

  return "quiet";
}

function buildAttentionItems(
  guilds: readonly GuildOperationsSummary[],
  activeMutes: readonly ActiveMuteSummary[],
  lookup: DiscordLookupStatus,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (!lookup.available) {
    items.push({
      id: "discord-lookup",
      severity: "info",
      title: "Discord Lookup Limited",
      detail: lookup.detail,
    });
  }

  for (const guild of guilds) {
    const guildName = guild.name ?? guild.guildId;

    if (guild.modLogsEnabled && !guild.logChannelId) {
      items.push({
        id: `${guild.guildId}-mod-log-channel`,
        severity: "critical",
        title: "Mod Logs Need A Channel",
        detail: `${guildName} has mod logs enabled without a destination channel.`,
        guildId: guild.guildId,
      });
    }

    if (guild.logChannelId && !guild.modLogsEnabled) {
      items.push({
        id: `${guild.guildId}-mod-logs-disabled`,
        severity: "warning",
        title: "Mod Logs Are Disabled",
        detail: `${guildName} has a log channel set, but delivery is turned off.`,
        guildId: guild.guildId,
      });
    }

    if (guild.muteMode === "role" && !guild.muteRoleId) {
      items.push({
        id: `${guild.guildId}-mute-role`,
        severity: "critical",
        title: "Mute Role Missing",
        detail: `${guildName} is set to role mutes without a role.`,
        guildId: guild.guildId,
      });
    }

    if (guild.muteMode === "none" && guild.activeMuteCount > 0) {
      items.push({
        id: `${guild.guildId}-mute-mode-none`,
        severity: "warning",
        title: "Stored Mutes Without Mute Mode",
        detail: `${guildName} has active mute records while mute configuration is off.`,
        guildId: guild.guildId,
      });
    }
  }

  for (const mute of activeMutes.filter((entry) => entry.status === "expired")) {
    items.push({
      id: `${mute.guildId}-${mute.userId}-expired-mute`,
      severity: "critical",
      title: "Mute Expiry Pending",
      detail: `${mute.displayName ?? mute.username ?? mute.userId} should already be unmuted in ${
        mute.guildName ?? mute.guildId
      }.`,
      guildId: mute.guildId,
    });
  }

  return items.slice(0, 12);
}

function countBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function channelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function roleKey(guildId: string, roleId: string): string {
  return `${guildId}:${roleId}`;
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
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

async function resolveDatabasePath(): Promise<string> {
  const configuredPath = getEnv("DATABASE_PATH")?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  const candidates = [
    join(repositoryRoot, "apps", "bot", "aripa.sqlite"),
    join(repositoryRoot, "aripa.sqlite"),
    join(repositoryRoot, "packages", "core", "aripa.sqlite"),
    join(appRoot, "aripa.sqlite"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return "aripa.sqlite";
}

export async function listReleases(): Promise<ReleasesResponse> {
  const { config } = await readConfig();
  const repo = config.updates.githubRepo;
  const releases = config.updates.enabled
    ? await fetchGitHubReleases(repo, getEnv("GITHUB_TOKEN")?.trim() || null)
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

interface LocalOperationsState {
  guildConfigs: LocalGuildConfig[];
  tags: LocalGuildTag[];
  activeMutes: LocalActiveMute[];
  error?: string;
}

interface LocalGuildConfig {
  guildId: string;
  logChannelId: string | null;
  modLogsEnabled: boolean;
  banMessage: string | null;
  muteRoleId: string | null;
  muteMode: "none" | "role" | "timeout";
  createdAt: string;
  updatedAt: string;
}

interface LocalGuildTag {
  guildId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface LocalActiveMute {
  guildId: string;
  userId: string;
  muteMode: "role";
  muteRoleId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DiscordGuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
}

interface DiscordNamedResource {
  id: string;
  name: string;
}

interface DiscordMemberSummary {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface DiscordGuildResponse {
  id: string;
  name: string;
  icon: string | null;
}

interface DiscordChannelResponse {
  id: string;
  name: string;
}

interface DiscordRoleResponse {
  id: string;
  name: string;
}

interface DiscordMemberResponse {
  nick: string | null;
  avatar: string | null;
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar: string | null;
  };
}
