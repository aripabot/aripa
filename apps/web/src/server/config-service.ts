import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import { loadWizardModelOptions } from "@aripabot/core/onboarding-wizard/model-options.ts";
import { getSelectableModelProviders } from "@aripabot/core/onboarding-wizard/provider-availability.ts";
import {
  loadStylePrompts,
  stylePromptDescription,
} from "@aripabot/core/onboarding-wizard/style-prompts.ts";
import { AUTO_UPDATE_CRON_PRESETS } from "@aripabot/core/update/auto-update-cron.ts";

import type {
  ActiveMuteSummary,
  AttentionItem,
  BotRuntimeStatus,
  DashboardStatus,
  DashboardOperations,
  DiscordLookupStatus,
  GuildOperationsSummary,
  OnboardingOptionsResponse,
  StylePromptOption,
} from "@/lib/api-types";
import { DOCKER_CONTAINER_NAME, isInsideDockerRuntime } from "@/server/docker-runtime";
import { readableError } from "@/lib/errors";
import { getEnv, getRootEnv } from "@/server/env";
import { readConfig } from "@/server/config-store";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const packageJsonPath = join(repositoryRoot, "package.json");
const webPackageJsonPath = join(appRoot, "package.json");
const execFileAsync = promisify(execFile);
const LOCAL_OPERATIONS_CACHE_TTL_MS = 10_000;
const DISCORD_DIRECTORY_CACHE_TTL_MS = 45_000;
const localOperationsCache = new Map<
  string,
  { expiresAtMs: number; state: LocalOperationsState }
>();
const localOperationsInflight = new Map<string, Promise<LocalOperationsState>>();
const discordDirectoryCache = new Map<
  string,
  { expiresAtMs: number; directory: DiscordDirectory }
>();
const discordDirectoryInflight = new Map<string, Promise<DiscordDirectory>>();

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
  const cached = localOperationsCache.get(databasePath);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.state;
  }

  const inflight = localOperationsInflight.get(databasePath);
  if (inflight) {
    return inflight;
  }

  const promise = readLocalOperationsFromDatabase(databasePath).then((state) => {
    localOperationsCache.set(databasePath, {
      expiresAtMs: Date.now() + LOCAL_OPERATIONS_CACHE_TTL_MS,
      state,
    });
    return state;
  });
  localOperationsInflight.set(databasePath, promise);

  try {
    return await promise;
  } finally {
    localOperationsInflight.delete(databasePath);
  }
}

async function readLocalOperationsFromDatabase(
  databasePath: string,
): Promise<LocalOperationsState> {
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
        ...getRootEnv(),
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
  if (isInsideDockerRuntime()) {
    return {
      state: "docker",
      label: "Running via Docker",
      detail: "Current Aripa Docker container is active.",
    };
  }

  if (await isDockerContainerRunning(DOCKER_CONTAINER_NAME)) {
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
    return stdout.split(/\r?\n/).some(isBotProcessCommand);
  } catch {
    return false;
  }
}

function isBotProcessCommand(command: string): boolean {
  if (!command.includes("src/index.ts")) {
    return false;
  }

  return (
    command.includes("apps/bot") ||
    command.includes("--cwd apps/bot") ||
    command.includes("--env-file=../../.env")
  );
}

async function getDiscordDirectory(
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
): Promise<DiscordDirectory> {
  const token = getEnv("TOKEN")?.trim();
  const cacheKey = discordDirectoryCacheKey(token, guildIds, activeMutes);
  const cached = discordDirectoryCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.directory;
  }

  const inflight = discordDirectoryInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = fetchDiscordDirectory(token, guildIds, activeMutes).then((directory) => {
    discordDirectoryCache.set(cacheKey, {
      expiresAtMs: Date.now() + DISCORD_DIRECTORY_CACHE_TTL_MS,
      directory,
    });
    return directory;
  });
  discordDirectoryInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    discordDirectoryInflight.delete(cacheKey);
  }
}

async function fetchDiscordDirectory(
  token: string | undefined,
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
): Promise<DiscordDirectory> {
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

function discordDirectoryCacheKey(
  token: string | undefined,
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
): string {
  const guildKey = [...guildIds].sort().join(",");
  const muteKey = activeMutes
    .map((mute) => `${mute.guildId}:${mute.userId}:${mute.muteRoleId}`)
    .sort()
    .join(",");

  return `${token ? hashString(token) : "no-token"}|${guildKey}|${muteKey}`;
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

  return join(repositoryRoot, "aripa.sqlite");
}

async function getStylePromptOptions(selectedStylePrompt: string): Promise<StylePromptOption[]> {
  const styles = await loadStylePrompts(selectedStylePrompt);

  return styles.map((style) => ({
    value: style,
    label: toTitleCase(style),
    description: stylePromptDescription(style),
  }));
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
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

interface DiscordDirectory {
  lookup: DiscordLookupStatus;
  guilds: Map<string, DiscordGuildSummary>;
  channels: Map<string, DiscordNamedResource>;
  roles: Map<string, DiscordNamedResource>;
  members: Map<string, DiscordMemberSummary>;
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
