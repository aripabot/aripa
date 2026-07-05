import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, open, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_RUNTIME_CONFIG,
  REASONING_EFFORTS,
  parseRuntimeJsonConfig,
  type RuntimeJsonConfig,
} from "@aripabot/core/config/runtime-config.ts";
import {
  buildRuntimeConfig,
  generateReleaseSigningKeyPair,
  type RuntimeOnboardingInput,
} from "@aripabot/core/config/onboarding.ts";
import { loadWizardModelOptions } from "@aripabot/core/onboarding-wizard/model-options.ts";
import { getSelectableModelProviders } from "@aripabot/core/onboarding-wizard/provider-availability.ts";
import {
  loadStylePrompts,
  stylePromptDescription,
} from "@aripabot/core/onboarding-wizard/style-prompts.ts";
import { AUTO_UPDATE_CRON_PRESETS } from "@aripabot/core/update/auto-update-cron.ts";
import {
  fetchGitHubReleases,
  installAutoUpdateCron,
  removeAutoUpdateCron,
} from "@aripabot/core/update/release-updater.ts";

import type {
  ActiveMuteSummary,
  AttentionItem,
  BotRuntimeStatus,
  CompleteOnboardingResponse,
  ConfigResponse,
  DashboardStatus,
  DashboardOperations,
  DiscordLookupStatus,
  GenerateSigningKeyResponse,
  DashboardLogEntry,
  DashboardLogSource,
  GuildOperationsSummary,
  LocalLogFile,
  LogEntryLevel,
  LogsResponse,
  OnboardingOptionsResponse,
  ReleasesResponse,
  SaveConfigResponse,
  StylePromptOption,
} from "@/lib/api-types";
import {
  CURRENT_DOCKER_SOURCE_ID,
  DOCKER_CONTAINER_NAME,
  HOST_DOCKER_SOURCE_ID,
  getDockerRuntimeLogPath,
  isInsideDockerRuntime,
} from "@/server/docker-runtime";
import { requestBotRuntimeConfigReload } from "@/server/bot-runtime-control";
import { readableError } from "@/lib/errors";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const defaultConfigPath = join(repositoryRoot, "config.json");
const packageJsonPath = join(repositoryRoot, "package.json");
const webPackageJsonPath = join(appRoot, "package.json");
const rootEnv = readRootEnv();
const execFileAsync = promisify(execFile);
const LOG_TAIL_LINE_COUNT = 500;
const LOG_FILE_TAIL_LINE_COUNT = 150;
const LOG_FILE_TAIL_BYTES = 256 * 1024;
const LOG_ENTRY_LEVELS = new Set<LogEntryLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "unknown",
]);
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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
    exists: existing !== null,
    raw: (existing ?? DEFAULT_RUNTIME_CONFIG) as Record<string, unknown>,
    config,
  };
}

export async function saveConfig(config: RuntimeJsonConfig): Promise<SaveConfigResponse> {
  const pathOrUrl = resolveConfigPath();
  const parsedConfig = parseRuntimeJsonConfig(config);
  const existing = await readExistingJsonObject(pathOrUrl);
  const mergedConfig = { ...existing, ...parsedConfig };
  const savedConfig = parseRuntimeJsonConfig(mergedConfig);

  await writeFile(pathOrUrl, `${JSON.stringify(mergedConfig, null, 2)}\n`);
  await requestBotRuntimeConfigReload();

  return {
    path: formatPath(pathOrUrl),
    exists: true,
    raw: mergedConfig,
    config: savedConfig,
    savedAt: new Date().toISOString(),
  };
}

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

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const configResponse = await readConfig();
  const [styles, botPackageJson, webPackageJson, botRuntime, providers] = await Promise.all([
    getStylePromptOptions(configResponse.config.stylePrompt),
    readJson<{ version?: string }>(packageJsonPath),
    readJson<{ version?: string }>(webPackageJsonPath),
    getBotRuntimeStatus(),
    getSelectableModelProviders(),
  ]);
  const databasePath = await resolveDatabasePath();
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

export async function readLocalLogs(): Promise<LogsResponse> {
  const candidates = [
    join(repositoryRoot, "aripa.log"),
    join(repositoryRoot, "aripa-update.log"),
    join(repositoryRoot, "apps", "bot", "aripa.log"),
    join(repositoryRoot, "apps", "bot", "aripa-update.log"),
  ];

  const [dockerSource, processSources, files] = await Promise.all([
    readDockerLogs(),
    readProcessLogs(),
    Promise.all(candidates.map(readLogCandidate)),
  ]);
  const fileSources = files.map(logFileToSource);
  const sources = [dockerSource, ...processSources, ...fileSources];
  const entries = [
    ...dockerSource.entries,
    ...processSources.flatMap((source) => source.entries),
    ...files.flatMap((file) => logFileToEntries(file)),
  ]
    .sort(compareLogEntries)
    .slice(-LOG_TAIL_LINE_COUNT);

  return {
    sources: sources.map(({ entries: _entries, ...source }) => source),
    entries,
    files,
  };
}

async function readDockerLogs(): Promise<LogSourceWithEntries> {
  if (isInsideDockerRuntime()) {
    return readCurrentDockerRuntimeLogs();
  }

  const running = await isDockerContainerRunning(DOCKER_CONTAINER_NAME);
  const source: DashboardLogSource = {
    id: HOST_DOCKER_SOURCE_ID,
    kind: "docker",
    name: "Docker",
    detail: DOCKER_CONTAINER_NAME,
    available: running,
    updatedAt: null,
    sizeBytes: null,
    message: running ? null : "Container logs are available when the Docker runtime is active.",
  };

  if (!running) {
    return { ...source, entries: [] };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--timestamps", "--tail", String(LOG_TAIL_LINE_COUNT), DOCKER_CONTAINER_NAME],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const lines = [...stdout.split(/\r?\n/), ...stderr.split(/\r?\n/)].filter(Boolean);

    return {
      ...source,
      entries: lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      available: false,
      message: `Docker logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function readCurrentDockerRuntimeLogs(): Promise<LogSourceWithEntries> {
  const logPath = getDockerRuntimeLogPath();
  const source: DashboardLogSource = {
    id: CURRENT_DOCKER_SOURCE_ID,
    kind: "docker",
    name: "Docker",
    detail: `Current container · ${logPath}`,
    available: false,
    updatedAt: null,
    sizeBytes: null,
    message: "Container runtime logs are not available yet.",
  };

  try {
    const file = await readLogCandidate(logPath);
    return {
      ...source,
      available: file.exists,
      updatedAt: file.updatedAt,
      sizeBytes: file.sizeBytes,
      message: file.exists ? null : `Container runtime log was not found at ${logPath}.`,
      entries: file.lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      message: `Container runtime logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function readProcessLogs(): Promise<LogSourceWithEntries[]> {
  const processIds = await findBotProcessIds();

  if (processIds.length === 0) {
    return [
      {
        id: "process:local",
        kind: "process",
        name: "Local Process",
        detail: "Aripa bot process",
        available: false,
        updatedAt: null,
        sizeBytes: null,
        message: "No local Aripa bot process was found.",
        entries: [],
      },
    ];
  }

  return Promise.all(processIds.map(readProcessLogSource));
}

async function findBotProcessIds(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 1_500 });
    return stdout
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match) {
          return null;
        }

        const pid = match[1];
        const command = match[2];
        if (!pid || !command) {
          return null;
        }

        return isBotProcessCommand(command) ? pid : null;
      })
      .filter((pid): pid is string => Boolean(pid));
  } catch {
    return [];
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

async function readProcessLogSource(pid: string): Promise<LogSourceWithEntries> {
  const stdoutPath = await getProcessStdoutPath(pid);
  const source: DashboardLogSource = {
    id: `process:${pid}`,
    kind: "process",
    name: "Local Process",
    detail: `PID ${pid}`,
    available: Boolean(stdoutPath),
    updatedAt: null,
    sizeBytes: null,
    message: stdoutPath
      ? null
      : "This process is not writing stdout to a readable file. Start Aripa with file logging or use Docker to view captured history.",
  };

  if (!stdoutPath) {
    return { ...source, entries: [] };
  }

  try {
    const file = await readLogCandidate(stdoutPath);
    return {
      ...source,
      available: file.exists,
      detail: `PID ${pid} · ${file.name}`,
      updatedAt: file.updatedAt,
      sizeBytes: file.sizeBytes,
      message: file.exists
        ? null
        : "This process stdout is not written to a readable file. Start Aripa with file logging or use Docker to view captured history.",
      entries: file.lines.map((line, index) => parseLogLine(line, source, index)),
    };
  } catch (error) {
    return {
      ...source,
      available: false,
      message: `Process logs could not be read: ${readableError(error)}`,
      entries: [],
    };
  }
}

async function getProcessStdoutPath(pid: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", pid, "-d", "1", "-Fn"], {
      timeout: 1_500,
    });
    const stdoutPath = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("n/"))
      ?.slice(1);

    return stdoutPath ?? null;
  } catch {
    return null;
  }
}

function logFileToSource(file: LocalLogFile): LogSourceWithEntries {
  return {
    id: `file:${file.path}`,
    kind: "file",
    name: file.name,
    detail: file.path,
    available: file.exists,
    updatedAt: file.updatedAt,
    sizeBytes: file.sizeBytes,
    message: file.exists ? null : "File not found.",
    entries: logFileToEntries(file),
  };
}

function logFileToEntries(file: LocalLogFile): DashboardLogEntry[] {
  const source = logFileToSourceMetadata(file);
  return file.lines.map((line, index) => parseLogLine(line, source, index));
}

function logFileToSourceMetadata(file: LocalLogFile): DashboardLogSource {
  return {
    id: `file:${file.path}`,
    kind: "file",
    name: file.name,
    detail: file.path,
    available: file.exists,
    updatedAt: file.updatedAt,
    sizeBytes: file.sizeBytes,
    message: file.exists ? null : "File not found.",
  };
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
    ? await fetchGitHubReleases({
        repo,
        token: getEnv("GITHUB_TOKEN")?.trim() || null,
        userAgent: "aripa-dashboard",
      })
    : [];

  return { repo, releases };
}

async function getStylePromptOptions(selectedStylePrompt: string): Promise<StylePromptOption[]> {
  const styles = await loadStylePrompts(selectedStylePrompt);

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
    if (!metadata.isFile()) {
      return {
        name,
        path,
        exists: false,
        updatedAt: null,
        sizeBytes: 0,
        lines: [],
      };
    }

    const lines = await readLogTailLines(path, metadata.size);

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

async function readLogTailLines(path: string, sizeBytes: number): Promise<string[]> {
  const byteLength = Math.min(sizeBytes, LOG_FILE_TAIL_BYTES);
  const start = Math.max(sizeBytes - byteLength, 0);
  const buffer = Buffer.alloc(byteLength);
  const file = await open(path, "r");

  try {
    const { bytesRead } = await file.read(buffer, 0, byteLength, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).filter(Boolean);

    if (start > 0) {
      lines.shift();
    }

    return lines.slice(-LOG_FILE_TAIL_LINE_COUNT);
  } finally {
    await file.close();
  }
}

export function parseLogLine(
  rawLine: string,
  source: Pick<DashboardLogSource, "id" | "kind" | "name">,
  index: number,
): DashboardLogEntry {
  const cleanedLine = redactLogText(stripAnsi(rawLine));
  const { timestamp, body } = splitDockerTimestamp(cleanedLine);
  const parsed = parsePinoJson(body);

  return {
    id: `${source.id}:${index}:${hashString(cleanedLine)}`,
    sourceId: source.id,
    sourceKind: source.kind,
    sourceName: source.name,
    level: parsed.level,
    timestamp: parsed.timestamp ?? timestamp,
    message: parsed.message,
    raw: parsed.raw,
    metadata: parsed.metadata,
  };
}

function splitDockerTimestamp(line: string): { timestamp: string | null; body: string } {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/);
  if (!match) {
    return { timestamp: null, body: line };
  }

  return { timestamp: normalizeTimestamp(match[1] ?? null), body: match[2] ?? "" };
}

function parsePinoJson(line: string): {
  level: LogEntryLevel;
  timestamp: string | null;
  message: string;
  raw: string;
  metadata: Record<string, unknown> | null;
} {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const message = getString(payload.msg) ?? getString(payload.message) ?? line;
    const timestamp = normalizeTimestamp(payload.time);
    const level = normalizeLogLevel(payload.level);
    const metadata = extractLogMetadata(payload);

    return {
      level,
      timestamp,
      message: redactLogText(message),
      raw: redactLogText(JSON.stringify(payload)),
      metadata: redactLogObject(metadata),
    };
  } catch {
    return {
      level: inferTextLogLevel(line),
      timestamp: null,
      message: line,
      raw: line,
      metadata: null,
    };
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function normalizeLogLevel(value: unknown): LogEntryLevel {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return isLogEntryLevel(lower) ? lower : "unknown";
  }

  if (typeof value !== "number") {
    return "unknown";
  }

  if (value >= 60) {
    return "fatal";
  }
  if (value >= 50) {
    return "error";
  }
  if (value >= 40) {
    return "warn";
  }
  if (value >= 30) {
    return "info";
  }
  if (value >= 20) {
    return "debug";
  }
  if (value >= 10) {
    return "trace";
  }

  return "unknown";
}

function isLogEntryLevel(value: string): value is LogEntryLevel {
  return LOG_ENTRY_LEVELS.has(value as LogEntryLevel);
}

function inferTextLogLevel(line: string): LogEntryLevel {
  const normalized = line.toLowerCase();

  if (/\bfatal\b/.test(normalized)) {
    return "fatal";
  }
  if (/\berror\b/.test(normalized)) {
    return "error";
  }
  if (/\bwarn(?:ing)?\b/.test(normalized)) {
    return "warn";
  }
  if (/\bdebug\b/.test(normalized)) {
    return "debug";
  }
  if (/\btrace\b/.test(normalized)) {
    return "trace";
  }
  if (/\binfo\b/.test(normalized)) {
    return "info";
  }

  return "unknown";
}

function extractLogMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (["level", "time", "timestamp", "msg", "message", "pid", "hostname"].includes(key)) {
      continue;
    }

    metadata[key] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function redactLogObject<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? (redactLogText(value) as T) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactLogObject(entry)) as T;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveLogKey(key) ? "[redacted]" : redactLogObject(entry),
    ]),
  ) as T;
}

function isSensitiveLogKey(key: string): boolean {
  return /token|authorization|api[_-]?key|secret|password/i.test(key);
}

function redactLogText(value: string): string {
  return value
    .replace(/(Bot\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(
      /((?:token|authorization|api[_-]?key|secret|password)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[redacted]",
    );
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function compareLogEntries(left: DashboardLogEntry, right: DashboardLogEntry): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
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

interface LogSourceWithEntries extends DashboardLogSource {
  entries: DashboardLogEntry[];
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
