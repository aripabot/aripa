// @bun-only: active mute persistence uses Bun's built-in SQLite driver.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "@aripabot/core/config/config.ts";

export interface ActiveMuteRecord {
  guildId: string;
  userId: string;
  muteMode: "role";
  muteRoleId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export class ActiveMuteStore {
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

  get(guildId: string, userId: string): ActiveMuteRecord | null {
    const row = this.db
      .query<ActiveMuteRow, [string, string]>(
        `SELECT guild_id, user_id, mute_mode, mute_role_id, expires_at, created_at, updated_at
         FROM active_mute
         WHERE guild_id = ? AND user_id = ?`,
      )
      .get(guildId, userId);

    return row ? mapRow(row) : null;
  }

  listAll(): ActiveMuteRecord[] {
    return this.db
      .query<ActiveMuteRow, []>(
        `SELECT guild_id, user_id, mute_mode, mute_role_id, expires_at, created_at, updated_at
         FROM active_mute`,
      )
      .all()
      .map(mapRow);
  }

  listExpiring(): ActiveMuteRecord[] {
    return this.db
      .query<ActiveMuteRow, []>(
        `SELECT guild_id, user_id, mute_mode, mute_role_id, expires_at, created_at, updated_at
         FROM active_mute
         WHERE expires_at IS NOT NULL`,
      )
      .all()
      .map(mapRow);
  }

  upsertRoleMute(options: {
    guildId: string;
    userId: string;
    muteRoleId: string;
    expiresAt?: string | null;
  }): ActiveMuteRecord {
    this.db
      .query(
        `INSERT INTO active_mute (guild_id, user_id, mute_mode, mute_role_id, expires_at)
         VALUES (?, ?, 'role', ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           mute_mode = excluded.mute_mode,
           mute_role_id = excluded.mute_role_id,
           expires_at = excluded.expires_at,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(options.guildId, options.userId, options.muteRoleId, options.expiresAt ?? null);

    return this.require(options.guildId, options.userId, "upserting active role mute");
  }

  delete(guildId: string, userId: string): void {
    this.db
      .query("DELETE FROM active_mute WHERE guild_id = ? AND user_id = ?")
      .run(guildId, userId);
  }

  private require(guildId: string, userId: string, operation: string): ActiveMuteRecord {
    const record = this.get(guildId, userId);

    if (record) {
      return record;
    }

    throw new Error(`Failed to load active mute after ${operation}.`);
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS active_mute (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        mute_mode TEXT NOT NULL,
        mute_role_id TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
  }
}

let defaultActiveMuteStore: ActiveMuteStore | null = null;

export function getActiveMuteStore(): ActiveMuteStore {
  defaultActiveMuteStore ??= new ActiveMuteStore();
  return defaultActiveMuteStore;
}

export function resetActiveMuteStoreForTests(): void {
  defaultActiveMuteStore?.close();
  defaultActiveMuteStore = null;
}

function mapRow(row: ActiveMuteRow): ActiveMuteRecord {
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

function ensureDatabaseDirectory(path: string): void {
  if (path === ":memory:" || path.startsWith("file:")) {
    return;
  }

  const directory = dirname(path);

  if (directory && directory !== ".") {
    mkdirSync(directory, { recursive: true });
  }
}
