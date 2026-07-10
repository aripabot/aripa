import { describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { ActiveMuteStore } from "@aripabot/core/moderation/active-mute-store.ts";

describe("ActiveMuteStore", () => {
  test("stores and deletes role mutes", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      const record = store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: null,
      });

      expect(record).toMatchObject({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: null,
        generation: 1,
      });
      expect(store.get("guild-1", "user-1")).toMatchObject({
        muteRoleId: "role-1",
      });

      store.delete("guild-1", "user-1");
      expect(store.get("guild-1", "user-1")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("increments generations and conditionally deletes the current record", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      const first = store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
      });
      const second = store.upsertReturningPrevious({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-2",
      });

      expect(second.previous?.generation).toBe(first.generation);
      expect(second.record.generation).toBe(first.generation + 1);
      expect(store.deleteIfGeneration("guild-1", "user-1", first.generation)).toBe(false);
      expect(store.deleteIfGeneration("guild-1", "user-1", second.record.generation)).toBe(true);
    } finally {
      store.close();
    }
  });

  test("never reuses a generation after deleting a mute", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      const first = store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
      });
      store.deleteIfGeneration(first.guildId, first.userId, first.generation);
      const replacement = store.upsertRoleMute({
        guildId: first.guildId,
        userId: first.userId,
        muteRoleId: "role-1",
      });

      expect(replacement.generation).toBe(first.generation + 1);
    } finally {
      store.close();
    }
  });

  test("migrates existing rows into generation tracking", async () => {
    const path = `${Bun.env.TMPDIR || "/tmp"}/aripa-active-mute-${crypto.randomUUID()}.sqlite`;
    const legacyDatabase = new Database(path);
    legacyDatabase.run(`
      CREATE TABLE active_mute (
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
    legacyDatabase
      .query(
        `INSERT INTO active_mute (guild_id, user_id, mute_mode, mute_role_id, expires_at)
         VALUES (?, ?, 'role', ?, ?)`,
      )
      .run("guild-1", "user-1", "role-1", null);
    legacyDatabase.close();

    const store = new ActiveMuteStore(path);
    try {
      expect(store.get("guild-1", "user-1")).toMatchObject({ generation: 1 });
      expect(
        store.upsertRoleMute({
          guildId: "guild-1",
          userId: "user-1",
          muteRoleId: "role-2",
        }).generation,
      ).toBe(2);
    } finally {
      store.close();
      await rm(path, { force: true });
    }
  });

  test("returns only a bounded set of due mute records", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "due-1",
        muteRoleId: "role-1",
        expiresAt: "2026-01-01T00:00:00.000Z",
      });
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "due-2",
        muteRoleId: "role-1",
        expiresAt: "2026-01-02T00:00:00.000Z",
      });
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "future",
        muteRoleId: "role-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

      expect(store.listDue("2026-01-03T00:00:00.000Z", 1).map((record) => record.userId)).toEqual([
        "due-1",
      ]);
    } finally {
      store.close();
    }
  });

  test("restores an exact prior mute record after a replacement", () => {
    const store = new ActiveMuteStore(":memory:");

    try {
      const original = store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-2",
        expiresAt: "2031-01-01T00:00:00.000Z",
      });

      store.restore(original);

      expect(store.get("guild-1", "user-1")).toEqual(original);
    } finally {
      store.close();
    }
  });
});
