import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Database as SQLiteDatabase } from "bun:sqlite";

import type { RuntimeJsonConfig } from "@aripabot/core/config/runtime-config.ts";

import type {
  ActiveMuteSummary,
  AttentionItem,
  BotRuntimeStatus,
  DashboardOperations,
  DiscordLookupStatus,
  GuildOperationsSummary,
} from "@/lib/api-types";
import { DOCKER_CONTAINER_NAME, isInsideDockerRuntime } from "@/server/docker-runtime";
import { readableError } from "@/lib/errors";
import { getEnv } from "@/server/env";
import { channelKey, getDiscordDirectory, memberKey, roleKey } from "@/server/discord-directory";

const appRoot = process.cwd();
const repositoryRoot = join(/* turbopackIgnore: true */ appRoot, "../..");
const execFileAsync = promisify(execFile);
const LOCAL_OPERATIONS_CACHE_TTL_MS = 10_000;
const localOperationsCache = new Map<
  string,
  { expiresAtMs: number; state: LocalOperationsState }
>();
const localOperationsInflight = new Map<string, Promise<LocalOperationsState>>();

export async function getDashboardOperations(
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
  const discord = await getDiscordDirectory(guildIds, activeMutes, guildConfigs);
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
  try {
    await access(databasePath);
  } catch {
    return { guildConfigs: [], tags: [], activeMutes: [] };
  }

  try {
    const { Database } = await import(/* turbopackIgnore: true */ "bun:sqlite");
    const db = new Database(databasePath, { readonly: true });

    try {
      return readLocalOperationsFromSqlite(db);
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      guildConfigs: [],
      tags: [],
      activeMutes: [],
      error: readableError(error),
    };
  }
}

function readLocalOperationsFromSqlite(db: SQLiteDatabase): LocalOperationsState {
  return {
    guildConfigs: tableExists(db, "guild_config")
      ? db
          .query<GuildConfigRow, []>(
            `SELECT guild_id, log_channel_id, mod_logs_enabled, ban_message, mute_role_id, mute_mode, created_at, updated_at
             FROM guild_config
             ORDER BY updated_at DESC, guild_id ASC`,
          )
          .all()
          .map(mapGuildConfigRow)
      : [],
    tags: tableExists(db, "guild_tag")
      ? db
          .query<GuildTagRow, []>(
            `SELECT guild_id, tag_name, content, created_at, updated_at
             FROM guild_tag
             ORDER BY guild_id ASC, tag_name ASC`,
          )
          .all()
          .map(mapGuildTagRow)
      : [],
    activeMutes: tableExists(db, "active_mute")
      ? db
          .query<ActiveMuteRow, []>(
            `SELECT guild_id, user_id, mute_mode, mute_role_id, expires_at, created_at, updated_at
             FROM active_mute`,
          )
          .all()
          .map(mapActiveMuteRow)
      : [],
  };
}

function tableExists(db: SQLiteDatabase, name: string): boolean {
  return Boolean(
    db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name),
  );
}

export async function getBotRuntimeStatus(): Promise<BotRuntimeStatus> {
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

export async function resolveDatabasePath(): Promise<string> {
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

interface GuildConfigRow {
  guild_id: string;
  log_channel_id: string | null;
  mod_logs_enabled: number;
  ban_message: string | null;
  mute_role_id: string | null;
  mute_mode: string;
  created_at: string;
  updated_at: string;
}

interface GuildTagRow {
  guild_id: string;
  tag_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface ActiveMuteRow {
  guild_id: string;
  user_id: string;
  mute_mode: string;
  mute_role_id: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapGuildConfigRow(row: GuildConfigRow): LocalGuildConfig {
  return {
    guildId: row.guild_id,
    logChannelId: row.log_channel_id,
    modLogsEnabled: row.mod_logs_enabled === 1,
    banMessage: row.ban_message,
    muteRoleId: row.mute_role_id,
    muteMode: normalizeMuteMode(row.mute_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGuildTagRow(row: GuildTagRow): LocalGuildTag {
  return {
    guildId: row.guild_id,
    name: row.tag_name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActiveMuteRow(row: ActiveMuteRow): LocalActiveMute {
  if (row.mute_mode !== "role") {
    throw new Error(`Unsupported mute mode in active_mute: ${row.mute_mode}`);
  }

  return {
    guildId: row.guild_id,
    userId: row.user_id,
    muteMode: "role",
    muteRoleId: row.mute_role_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMuteMode(value: string): LocalGuildConfig["muteMode"] {
  return value === "role" || value === "timeout" ? value : "none";
}
