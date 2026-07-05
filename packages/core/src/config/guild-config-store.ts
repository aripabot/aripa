// Bun-only module: persistent guild config storage uses Bun's built-in SQLite driver.
import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "@aripabot/core/config/config.ts";

export interface GuildConfig {
  guildId: string;
  logChannelId: string | null;
  modLogsEnabled: boolean;
  banMessage: string | null;
  muteRoleId: string | null;
  muteMode: MuteMode;
  createdAt: string;
  updatedAt: string;
}

export type MuteMode = "none" | "role" | "timeout";

export interface GuildTag {
  guildId: string;
  name: string;
  content: string;
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

export class GuildConfigStore {
  readonly db: Database;

  constructor(path = config.databasePath) {
    ensureDatabaseDirectory(path);
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  getGuildConfig(guildId: string): GuildConfig | null {
    const row = this.db
      .query<GuildConfigRow, [string]>(
        `SELECT guild_id, log_channel_id, mod_logs_enabled, ban_message, mute_role_id, mute_mode, created_at, updated_at
         FROM guild_config
         WHERE guild_id = ?`,
      )
      .get(guildId);

    return row ? mapGuildConfigRow(row) : null;
  }

  listGuildConfigs(): GuildConfig[] {
    return this.db
      .query<GuildConfigRow, []>(
        `SELECT guild_id, log_channel_id, mod_logs_enabled, ban_message, mute_role_id, mute_mode, created_at, updated_at
         FROM guild_config
         ORDER BY updated_at DESC, guild_id ASC`,
      )
      .all()
      .map(mapGuildConfigRow);
  }

  getLogChannelId(guildId: string): string | null {
    return this.getGuildConfig(guildId)?.logChannelId ?? null;
  }

  isModLogEnabled(guildId: string): boolean {
    return this.getGuildConfig(guildId)?.modLogsEnabled ?? false;
  }

  getBanMessage(guildId: string): string | null {
    return this.getGuildConfig(guildId)?.banMessage ?? null;
  }

  getMuteRoleId(guildId: string): string | null {
    return this.getGuildConfig(guildId)?.muteRoleId ?? null;
  }

  getMuteMode(guildId: string): MuteMode {
    return this.getGuildConfig(guildId)?.muteMode ?? "none";
  }

  setLogChannel(guildId: string, channelId: string | null): GuildConfig {
    this.db
      .query(
        `INSERT INTO guild_config (guild_id, log_channel_id, mod_logs_enabled)
         VALUES (?, ?, 0)
         ON CONFLICT(guild_id) DO UPDATE SET
           log_channel_id = excluded.log_channel_id,
           mod_logs_enabled = CASE
             WHEN excluded.log_channel_id IS NULL THEN 0
             ELSE guild_config.mod_logs_enabled
           END,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, channelId);

    return this.requireGuildConfig(guildId, "setting log channel");
  }

  setModLogEnabled(guildId: string, enabled: boolean): GuildConfig {
    this.db
      .query(
        `INSERT INTO guild_config (guild_id, mod_logs_enabled)
         VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           mod_logs_enabled = excluded.mod_logs_enabled,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, enabled ? 1 : 0);

    return this.requireGuildConfig(guildId, enabled ? "enabling mod logs" : "disabling mod logs");
  }

  setBanMessage(guildId: string, banMessage: string | null): GuildConfig {
    this.db
      .query(
        `INSERT INTO guild_config (guild_id, ban_message)
         VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           ban_message = excluded.ban_message,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, banMessage);

    return this.requireGuildConfig(guildId, "setting ban message");
  }

  setMuteRole(guildId: string, roleId: string | null): GuildConfig {
    const muteMode: MuteMode = roleId ? "role" : "none";

    this.db
      .query(
        `INSERT INTO guild_config (guild_id, mute_role_id, mute_mode)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           mute_role_id = excluded.mute_role_id,
           mute_mode = excluded.mute_mode,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, roleId, muteMode);

    return this.requireGuildConfig(guildId, roleId ? "setting mute role" : "clearing mute role");
  }

  setMuteMode(guildId: string, muteMode: MuteMode): GuildConfig {
    const muteRoleId = muteMode === "role" ? this.getMuteRoleId(guildId) : null;

    this.db
      .query(
        `INSERT INTO guild_config (guild_id, mute_role_id, mute_mode)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           mute_role_id = excluded.mute_role_id,
           mute_mode = excluded.mute_mode,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, muteRoleId, muteMode);

    return this.requireGuildConfig(guildId, `setting mute mode to ${muteMode}`);
  }

  getTag(guildId: string, name: string): GuildTag | null {
    const normalizedName = normalizeTagName(name);

    if (!normalizedName) {
      return null;
    }

    const row = this.db
      .query<GuildTagRow, [string, string]>(
        `SELECT guild_id, tag_name, content, created_at, updated_at
         FROM guild_tag
         WHERE guild_id = ? AND tag_name = ?`,
      )
      .get(guildId, normalizedName);

    if (!row) {
      return null;
    }

    return mapGuildTagRow(row);
  }

  listTags(guildId: string): GuildTag[] {
    return this.db
      .query<GuildTagRow, [string]>(
        `SELECT guild_id, tag_name, content, created_at, updated_at
         FROM guild_tag
         WHERE guild_id = ?
         ORDER BY tag_name ASC`,
      )
      .all(guildId)
      .map(mapGuildTagRow);
  }

  listAllTags(): GuildTag[] {
    return this.db
      .query<GuildTagRow, []>(
        `SELECT guild_id, tag_name, content, created_at, updated_at
         FROM guild_tag
         ORDER BY guild_id ASC, tag_name ASC`,
      )
      .all()
      .map(mapGuildTagRow);
  }

  upsertTag(guildId: string, name: string, content: string): GuildTag {
    const normalizedName = requireNormalizedTagName(name);

    this.db
      .query(
        `INSERT INTO guild_tag (guild_id, tag_name, content)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, tag_name) DO UPDATE SET
           content = excluded.content,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(guildId, normalizedName, content);

    const tag = this.getTag(guildId, normalizedName);

    if (tag) {
      return tag;
    }

    throw new Error(`Failed to load guild tag after setting "${normalizedName}".`);
  }

  deleteTag(guildId: string, name: string): boolean {
    const normalizedName = normalizeTagName(name);

    if (!normalizedName) {
      return false;
    }

    const result = this.db
      .query("DELETE FROM guild_tag WHERE guild_id = ? AND tag_name = ?")
      .run(guildId, normalizedName);

    return (result.changes ?? 0) > 0;
  }

  private requireGuildConfig(guildId: string, operation: string): GuildConfig {
    const config = this.getGuildConfig(guildId);

    if (config) {
      return config;
    }

    throw new Error(`Failed to load guild config after ${operation}.`);
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        log_channel_id TEXT,
        mod_logs_enabled INTEGER NOT NULL DEFAULT 0,
        ban_message TEXT,
        mute_role_id TEXT,
        mute_mode TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS guild_tag (
        guild_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, tag_name)
      )
    `);

    const columns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(guild_config)")
      .all()
      .map((column) => column.name);

    if (!columns.includes("mod_logs_enabled")) {
      this.db.run(
        "ALTER TABLE guild_config ADD COLUMN mod_logs_enabled INTEGER NOT NULL DEFAULT 0",
      );
    }

    if (!columns.includes("ban_message")) {
      this.db.run("ALTER TABLE guild_config ADD COLUMN ban_message TEXT");
    }

    if (!columns.includes("mute_role_id")) {
      this.db.run("ALTER TABLE guild_config ADD COLUMN mute_role_id TEXT");
    }

    if (!columns.includes("mute_mode")) {
      this.db.run("ALTER TABLE guild_config ADD COLUMN mute_mode TEXT NOT NULL DEFAULT 'none'");
    }
  }
}

let defaultGuildConfigStore: GuildConfigStore | null = null;

export function getGuildConfigStore(): GuildConfigStore {
  defaultGuildConfigStore ??= new GuildConfigStore();
  return defaultGuildConfigStore;
}

export function resetGuildConfigStoreForTests(): void {
  defaultGuildConfigStore?.close();
  defaultGuildConfigStore = null;
}

function mapGuildConfigRow(row: GuildConfigRow): GuildConfig {
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

function mapGuildTagRow(row: GuildTagRow): GuildTag {
  return {
    guildId: row.guild_id,
    name: row.tag_name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMuteMode(value: string): MuteMode {
  return value === "role" || value === "timeout" ? value : "none";
}

function ensureDatabaseDirectory(path: string): void {
  if (path === ":memory:" || path.startsWith("file:")) {
    return;
  }

  const directory = dirname(path);

  if (directory && directory !== ".") {
    mkdirSync(directory, { recursive: true });
  }
}

function normalizeTagName(name: string): string | null {
  const normalizedName = name.trim().toLowerCase();
  return normalizedName ? normalizedName : null;
}

function requireNormalizedTagName(name: string): string {
  const normalizedName = normalizeTagName(name);

  if (normalizedName) {
    return normalizedName;
  }

  throw new Error("Tag name cannot be empty.");
}
