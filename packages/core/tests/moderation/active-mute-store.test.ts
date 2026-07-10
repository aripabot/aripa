import { describe, expect, test } from "vitest";
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
});
